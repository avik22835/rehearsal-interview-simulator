"""Container supervisor. Inputs contain no expected answers or private tests."""
import json
import subprocess
import sys
import time
payload=json.loads(sys.stdin.read());results=[];start=time.monotonic()
for index,case in enumerate(payload['cases']):
    if time.monotonic()-start>17:break
    began=time.monotonic();result_path=f'/tmp/result-{index}.json'
    with open('/tmp/stdout.txt','w+') as output,open('/tmp/stderr.txt','w+') as errors:
        try:
            if payload['io_mode']=='stdin':
                args=[sys.executable,'-I','-B','/work/main.py'];text=case['stdin']
            else:
                args=[sys.executable,'-I','-B','/work/invoke.py',result_path]
                text=json.dumps({**case,'entry_point':payload['entry_point'],'custom_driver':payload.get('custom_driver',False)})
            proc=subprocess.run(args,input=text,text=True,stdout=output,stderr=errors,timeout=3)
            output.seek(0);errors.seek(0)
            if proc.returncode:result={'status':'error','error':errors.read(4000) or f'Process exited with code {proc.returncode}.'}
            elif payload['io_mode']=='stdin':
                actual=output.read(32001)
                result={'status':'complete','actual':actual,'stdout':''} if len(actual)<=32000 else {'status':'error','error':'Output exceeded 32000 characters.'}
            else:
                with open(result_path) as saved:
                    value=saved.read(36001)
                    if len(value)>36000:raise ValueError('Result exceeded the output limit.')
                    result=json.loads(value)
        except subprocess.TimeoutExpired:result={'status':'timeout','error':'This example exceeded 3 seconds.'}
        except BaseException as error:result={'status':'error','error':str(error)[:1000]}
    result['elapsed_ms']=round((time.monotonic()-began)*1000);results.append(result)
print(json.dumps(results,allow_nan=False))
