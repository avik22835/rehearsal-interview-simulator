"""Bounded Docker-only execution. Expected answers never enter the container."""
import asyncio
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4
from .execution_driver import execution_driver

IMAGE=os.getenv('SIMULATOR_RUNNER_IMAGE','python:3.12-alpine')
RUNTIME=Path(__file__).with_name('runner_runtime')

def runner_status():
    if not shutil.which('docker'):return {'available':False,'message':'Docker CLI is not installed.','image':IMAGE}
    try:
        reply=subprocess.run(['docker','info','--format','{{.OSType}}'],capture_output=True,text=True,timeout=5)
        if reply.returncode or reply.stdout.strip()!='linux':return {'available':False,'message':'Start Docker Desktop with its Linux engine.','image':IMAGE}
        image=subprocess.run(['docker','image','inspect','--format','{{.Id}}',IMAGE],capture_output=True,text=True,timeout=5)
        if image.returncode:return {'available':False,'message':f'Python runner image is missing. Run docker pull {IMAGE} once.','image':IMAGE}
        return {'available':True,'message':'Isolated Python runner ready.','image':IMAGE,'image_id':image.stdout.strip()}
    except (OSError,subprocess.TimeoutExpired):return {'available':False,'message':'Docker did not respond. Check Docker Desktop.','image':IMAGE}

def equivalent(actual,expected,comparison='exact'):
    if comparison=='float':
        return isinstance(actual,(int,float)) and not isinstance(actual,bool) and isinstance(expected,(int,float)) and not isinstance(expected,bool) and math.isclose(actual,expected,rel_tol=1e-9,abs_tol=1e-9)
    if comparison=='unordered':
        if not isinstance(actual,list) or not isinstance(expected,list):return False
        return sorted(json.dumps(item,sort_keys=True,allow_nan=False) for item in actual)==sorted(json.dumps(item,sort_keys=True,allow_nan=False) for item in expected)
    if isinstance(actual,bool) != isinstance(expected,bool):return False
    if isinstance(actual,(int,float)) and isinstance(expected,(int,float)):return actual==expected
    if type(actual) is not type(expected):return False
    if isinstance(actual,list):return len(actual)==len(expected) and all(equivalent(a,b) for a,b in zip(actual,expected))
    if isinstance(actual,dict):return actual.keys()==expected.keys() and all(equivalent(actual[key],expected[key]) for key in actual)
    return actual==expected

def docker_command(name,work,image):
    return ['docker','run','--rm','-i','--name',name,'--network','none','--read-only',
        '--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64',
        '--memory','256m','--memory-swap','256m','--cpus','1','--ulimit','nofile=64:64',
        '--ulimit','cpu=8:8','--user','65534:65534','--init',
        '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--mount',f'type=bind,source={work},target=/work,readonly',
        image,'python','-I','-B','/work/driver.py']

async def execute_python(code,problem):
    status=await asyncio.to_thread(runner_status)
    if not status['available']:raise ValueError(status['message'])
    name='rehearsal-'+uuid4().hex
    tests=problem['examples']
    manifest=execution_driver(problem)
    inputs={'io_mode':problem['io_mode'],'entry_point':problem['entry_point'],
        'custom_driver':bool(problem.get('driver')),
        'cases':[{key:case.get(key,default) for key,default in [('args',[]),('kwargs',{}),('stdin','')]} for case in tests]}
    started=time.monotonic();process=None
    with tempfile.TemporaryDirectory(prefix='rehearsal-run-') as directory:
        work=Path(directory)
        (work/'main.py').write_text(code,encoding='utf-8')
        # Execute the exact source captured in this run's immutable manifest.
        for filename,source in manifest['files'].items():(work/filename).write_text(source,encoding='utf-8',newline='')
        readers=[]
        async def limited(stream,limit):
            chunks=[];size=0
            while True:
                chunk=await stream.read(8192)
                if not chunk:break
                size+=len(chunk)
                if size>limit:raise ValueError('Runner output exceeded its limit.')
                chunks.append(chunk)
            return b''.join(chunks)
        try:
            process=await asyncio.create_subprocess_exec(*docker_command(name,str(work),status['image_id']),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            try:
                process.stdin.write(json.dumps(inputs,allow_nan=False).encode());await process.stdin.drain();process.stdin.close()
                readers=[asyncio.create_task(limited(process.stdout,600000)),asyncio.create_task(limited(process.stderr,16000))]
                stdout,stderr,_=await asyncio.wait_for(asyncio.gather(*readers,process.wait()),timeout=22)
            except asyncio.TimeoutError:
                return {'status':'timeout','cases':[],'message':'The isolated run exceeded its 22 second limit.','elapsed_ms':round((time.monotonic()-started)*1000),'image':status['image_id'],'driver':manifest}
            if process.returncode:
                return {'status':'error','cases':[],'message':'Container execution failed: '+stderr.decode(errors='replace')[-2000:],'elapsed_ms':round((time.monotonic()-started)*1000),'image':status['image_id'],'driver':manifest}
            try:observations=json.loads(stdout)
            except ValueError:raise ValueError('The isolated runner did not return valid results.') from None
            results=[]
            for index,case in enumerate(tests):
                observed=observations[index] if index<len(observations) else {'status':'not_run','error':'The overall execution budget was exhausted.'}
                passed=False
                if observed['status']=='complete':
                    actual=observed.get('actual')
                    passed=(actual.rstrip('\r\n')==case['expected'].rstrip('\r\n')) if problem['io_mode']=='stdin' and isinstance(actual,str) else equivalent(actual,case['expected'],case.get('comparison','exact'))
                results.append({**observed,'label':case['label'],'input':{'args':case.get('args',[]),'kwargs':case.get('kwargs',{}),'stdin':case.get('stdin','')},'expected':case['expected'],'passed':passed,'status':'passed' if passed else 'failed' if observed['status']=='complete' else observed['status']})
            return {'status':'complete','cases':results,'elapsed_ms':round((time.monotonic()-started)*1000),'image':status['image_id'],'driver':manifest,'message':'Public examples only. This is not a complete correctness proof.'+(' The model-generated driver also needs review if results look wrong.' if problem.get('driver') else '')}
        finally:
            for reader in readers:
                if not reader.done():reader.cancel()
            async def cleanup():
                try:
                    remover=await asyncio.create_subprocess_exec('docker','rm','-f',name,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
                    await asyncio.wait_for(remover.wait(),5)
                except (OSError,asyncio.TimeoutError):pass
                if process and process.returncode is None:
                    process.kill()
                    try:await asyncio.wait_for(process.communicate(),3)
                    except asyncio.TimeoutError:pass
            await asyncio.shield(cleanup())
