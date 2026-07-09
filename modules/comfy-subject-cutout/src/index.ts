import { requireOptionalNativeModule } from 'expo';

interface SubjectCutoutResult {
  uri: string;
  width: number;
  height: number;
}

interface ComfySubjectCutoutModule {
  createSubjectCutoutAsync(uri: string): Promise<SubjectCutoutResult>;
}

function getSubjectCutoutModule() {
  const module = requireOptionalNativeModule<ComfySubjectCutoutModule>('ComfySubjectCutout');
  if (!module) {
    throw new Error('Subject cutout is not available in this build.');
  }
  return module;
}

export async function createSubjectCutoutAsync(uri: string) {
  return getSubjectCutoutModule().createSubjectCutoutAsync(uri);
}
