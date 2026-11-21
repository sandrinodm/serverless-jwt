import assert from 'node:assert/strict';

/**
 * Assigns only the release project's PR applications while requiring every fixture to be
 * registered.
 */
export function releaseApplicationNames(matrix, applications, selected) {
  for (const name of applications) {
    assert.ok(
      matrix.some((row) => (row.application ?? row.integration) === name),
      'Application has no capability matrix registration: ' + name,
    );
  }

  const names = [
    ...new Set(
      matrix.filter((row) => row.project === 'pr').map((row) => row.application ?? row.integration),
    ),
  ].filter((name) => !selected || name === selected);
  assert.ok(names.length, 'No PR application was assigned to the release project');
  for (const name of names) {
    assert.ok(applications.includes(name), 'PR matrix application is missing: ' + name);
  }

  return names;
}

/**
 * Native builders share project assignment with discovery; PR preparation cannot require nightly
 * SDKs.
 */
export function buildApplicationNames(matrix, applications, project, integration) {
  assert.ok(project === 'pr' || project === 'nightly', 'Unknown e2e build project');
  const names = [
    ...new Set(
      matrix
        .filter(
          (row) =>
            (project === 'nightly' || row.project === 'pr') &&
            (!integration || row.integration === integration),
        )
        .map((row) => row.application ?? row.integration),
    ),
  ];
  assert.ok(names.length, 'No e2e build application was assigned');
  for (const name of names) {
    assert.ok(applications.includes(name), 'Matrix build application is missing: ' + name);
  }

  return names;
}
