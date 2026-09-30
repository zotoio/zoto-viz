/**
 * #192: the one place a test may turn a partial fake into the full type. Wrap only collaborators faked
 * around the code under test (a stub WebGLRenderingContext, Storage, Scene, ...), never the module under
 * test or its return value. Small full hand-written fakes need no helper.
 *
 * web/src/tsconfig-test-exclude.test.ts exempts this file (and only this file) from the test-cast row.
 */
export function mockPartial<T>(partial: Partial<T>): T {
  return partial as T;
}
