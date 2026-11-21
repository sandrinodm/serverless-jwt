import type { ALBEvent, APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from 'aws-lambda';

/**
 * API Gateway REST proxy fixture follows AWS's Lambda proxy request example:
 * https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 */
export function apiGatewayV1(): APIGatewayProxyEvent {
  return { resource: '/protected', path: '/protected', httpMethod: 'GET', headers: {}, multiValueHeaders: {}, queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null, stageVariables: null, body: null, isBase64Encoded: false, requestContext: { accountId: '123456789012', apiId: 'fixture', authorizer: null, protocol: 'HTTP/1.1', httpMethod: 'GET', identity: { accessKey: null, accountId: null, apiKey: null, apiKeyId: null, caller: null, clientCert: null, cognitoAuthenticationProvider: null, cognitoAuthenticationType: null, cognitoIdentityId: null, cognitoIdentityPoolId: null, principalOrgId: null, sourceIp: '127.0.0.1', user: null, userAgent: 'fixture', userArn: null }, path: '/protected', stage: '$default', requestId: 'fixture', requestTimeEpoch: 0, resourceId: 'fixture', resourcePath: '/protected' } };
}
/**
 * HTTP API payload 2.0 fixture follows AWS's documented request event:
 * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
 */
export function apiGatewayV2(): APIGatewayProxyEventV2 {
  return { version: '2.0', routeKey: '$default', rawPath: '/protected', rawQueryString: '', headers: {}, requestContext: { accountId: '123456789012', apiId: 'fixture', domainName: 'fixture.execute-api.example', domainPrefix: 'fixture', http: { method: 'GET', path: '/protected', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'fixture' }, requestId: 'fixture', routeKey: '$default', stage: '$default', time: '01/Jan/1970:00:00:00 +0000', timeEpoch: 0 }, isBase64Encoded: false };
}
/**
 * ALB Lambda target fixture follows AWS's multi-value-header request example:
 * https://docs.aws.amazon.com/elasticloadbalancing/latest/application/lambda-functions.html
 */
export function alb(): ALBEvent {
  return { requestContext: { elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:region:123456789012:targetgroup/fixture/fixture' } }, httpMethod: 'GET', path: '/protected', multiValueQueryStringParameters: {}, multiValueHeaders: {}, body: null, isBase64Encoded: false };
}
/**
 * Original context conforms to @types/aws-lambda's Context interface, without invented fields.
 * https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/aws-lambda/handler.d.ts
 */
export function context(): Context {
  return { callbackWaitsForEmptyEventLoop: false, functionName: 'fixture', functionVersion: '$LATEST', invokedFunctionArn: 'arn:aws:lambda:region:123456789012:function:fixture', memoryLimitInMB: '128', awsRequestId: 'fixture', logGroupName: 'fixture', logStreamName: 'fixture', getRemainingTimeInMillis: () => 30_000, done: () => {}, fail: () => {}, succeed: () => {} };
}
