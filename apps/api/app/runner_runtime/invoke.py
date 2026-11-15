"""Runs inside Docker only, once per function example."""
import contextlib
import importlib.util
import json
import sys
import traceback
import typing
payload=json.loads(sys.stdin.read())
result_path=sys.argv[1]
result={}
stage='driver_setup'
with open('/tmp/candidate-log.txt','w+',encoding='utf-8') as log:
    try:
        with contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):
            adapter=None
            if payload.get('custom_driver'):
                adapter_spec=importlib.util.spec_from_file_location('adapter','/work/adapter.py')
                adapter=importlib.util.module_from_spec(adapter_spec);sys.modules['adapter']=adapter;adapter_spec.loader.exec_module(adapter)
            spec=importlib.util.spec_from_file_location('candidate','/work/main.py')
            module=importlib.util.module_from_spec(spec)
            module.__dict__.update({name:getattr(typing,name) for name in ['List','Optional','Tuple','Dict','Set','Any','Deque']})
            if adapter:
                provided=getattr(adapter,'CANDIDATE_GLOBALS',{})
                if not isinstance(provided,dict) or any(not isinstance(key,str) or not key.isidentifier() or key.startswith('__') for key in provided):raise ValueError('Invalid CANDIDATE_GLOBALS in driver.')
                module.__dict__.update(provided)
            stage='candidate_load';sys.modules['candidate']=module;spec.loader.exec_module(module)
            stage='adapter_or_solution' if adapter else 'solution'
            if adapter:actual=adapter.run_case(module,payload['args'],payload['kwargs'])
            else:
                names=payload['entry_point'].split('.')
                function=getattr(module,names[0]) if len(names)==1 else getattr(getattr(module,names[0])(),names[1])
                actual=function(*payload['args'],**payload['kwargs'])
        # Reject non-JSON and non-finite results instead of pretending they match.
        stage='output_serialization';encoded=json.dumps(actual,allow_nan=False)
        if len(encoded)>30000:raise ValueError('Returned value exceeds the output limit.')
        result={'status':'complete','actual':actual}
    except BaseException:
        result={'status':'error','error_stage':stage,'error':traceback.format_exc(limit=5)[-4000:]}
    log.seek(0);result['stdout']=log.read(4000)
with open(result_path,'w',encoding='utf-8') as output:json.dump(result,output,allow_nan=False)
