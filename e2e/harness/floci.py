"""Provision only local Floci APIs and Lambda functions; never contact real AWS accounts."""
import io
import json
import pathlib
import sys
import zipfile

import boto3
from botocore.config import Config

state_path = pathlib.Path(sys.argv[2])
state = json.loads(state_path.read_text())
config = Config(connect_timeout=3, read_timeout=60, retries={'max_attempts': 0})


def client(service):
    """Use dummy credentials and the explicit loopback emulator endpoint exclusively."""
    return boto3.client(service, endpoint_url=state['endpoint'], region_name='us-east-1',
                        aws_access_key_id='test', aws_secret_access_key='test', config=config)


lam = client('lambda')
rest = client('apigateway')
http = client('apigatewayv2')


def save():
    """Persist owned identifiers after each mutation so partial provisioning is disposable."""
    state_path.write_text(json.dumps(state))


if sys.argv[1] == 'delete':
    failures = []
    for kind, identifier in state.get('owned', []):
        try:
            if kind == 'rest':
                rest.delete_rest_api(restApiId=identifier)
            elif kind == 'http':
                http.delete_api(ApiId=identifier)
            else:
                lam.delete_function(FunctionName=identifier)
        except Exception:
            failures.append(kind)
    if failures:
        raise RuntimeError('Unable to delete owned Floci resources: ' + ','.join(failures))
else:
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as bundle:
        for filename in ['index.mjs', 'ca.crt']:
            bundle.write(pathlib.Path(state['code']) / filename, filename)
    state['owned'] = []
    functions = {}
    for kind in ['v1', 'v2']:
        name = state['namespace'] + '-' + kind
        created = lam.create_function(FunctionName=name, Runtime='nodejs24.x',
            Role='arn:aws:iam::000000000000:role/synthetic-e2e', Handler='index.nativeControl' if state.get('nativeControl') else 'index.' + kind,
            Code={'ZipFile': archive.getvalue()}, Timeout=15, Architectures=['x86_64'],
            Environment={'Variables': {'ISSUER': state['issuer'], 'E2E_LOG_CONTROL': '1' if state.get('logControl') else '0', 'NODE_EXTRA_CA_CERTS': '/var/task/ca.crt' if state.get('trustCA', True) else ''}})
        functions[kind] = created['FunctionArn']
        state['owned'].append(['function', name])
        save()
    created = rest.create_rest_api(name=state['namespace'])
    api_id = created['id']
    state['owned'].insert(0, ['rest', api_id])
    save()
    root = next(resource['id'] for resource in rest.get_resources(restApiId=api_id)['items'] if resource['path'] == '/')
    proxy = rest.create_resource(restApiId=api_id, parentId=root, pathPart='{proxy+}')['id']
    for resource in [root, proxy]:
        rest.put_method(restApiId=api_id, resourceId=resource, httpMethod='ANY', authorizationType='NONE')
        rest.put_integration(restApiId=api_id, resourceId=resource, httpMethod='ANY', type='AWS_PROXY',
            integrationHttpMethod='POST', uri='arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/' + functions['v1'] + '/invocations')
    rest.create_deployment(restApiId=api_id, stageName='e2e')
    state['restURL'] = state['endpoint'] + '/execute-api/' + api_id + '/e2e'
    created = http.create_api(Name=state['namespace'], ProtocolType='HTTP')
    api_id = created['ApiId']
    state['owned'].insert(0, ['http', api_id])
    save()
    integration = http.create_integration(ApiId=api_id, IntegrationType='AWS_PROXY', IntegrationUri=functions['v2'], PayloadFormatVersion='2.0')
    http.create_route(ApiId=api_id, RouteKey='$default', Target='integrations/' + integration['IntegrationId'])
    http.create_stage(ApiId=api_id, StageName='e2e', AutoDeploy=True)
    state['httpURL'] = state['endpoint'] + '/execute-api/' + api_id + '/e2e'
    save()
