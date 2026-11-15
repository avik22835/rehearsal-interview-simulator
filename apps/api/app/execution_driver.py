"""Reviewable runtime manifest; reading this never executes model/candidate code."""
import hashlib
import json
from pathlib import Path

RUNTIME=Path(__file__).with_name('runner_runtime')

def execution_driver(problem):
    custom=problem.get('driver')
    files={name:(RUNTIME/name).read_text(encoding='utf-8') for name in ['driver.py','invoke.py']}
    if custom:files['adapter.py']=custom['code']
    digest=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()
    return {'source':'model' if custom else 'application','sha256':digest,'files':files,
        'description':custom['description'] if custom else 'Application-owned runner: call the entry point with JSON arguments, or execute the complete stdin program.',
        'input_format':custom['input_format'] if custom else 'JSON args/kwargs for functions; raw stdin for programs.',
        'output_format':custom['output_format'] if custom else 'JSON return value for functions; stdout text for programs.',
        'note':'Model-generated adapter; inspect it if results look wrong. Not an official LeetCode judge.' if custom else 'Generic JSON/stdin harness. Custom structures need a problem-specific adapter.'}
