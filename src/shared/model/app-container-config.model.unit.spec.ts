import { appContainerConfigZodModel, normalizeRuntimeClassName } from './app-container-config.model';

describe('app-container-config.model RuntimeClass validation', () => {
    it.each(['kata', 'kata-qemu', 'kata.qemu', 'a'.repeat(253)])('accepts valid RuntimeClass name %s', (runtimeClassName) => {
        expect(appContainerConfigZodModel.safeParse({ runtimeClassName }).success).toBe(true);
    });

    it.each(['Bad Name!', 'kata/handler', '-kata', 'kata-', 'kata.', 'käta', 'a'.repeat(254)])('rejects invalid RuntimeClass name %s', (runtimeClassName) => {
        expect(appContainerConfigZodModel.safeParse({ runtimeClassName }).success).toBe(false);
    });

    it('normalizes empty RuntimeClass names to null', () => {
        expect(normalizeRuntimeClassName('')).toBeNull();
        expect(normalizeRuntimeClassName('   ')).toBeNull();
        expect(normalizeRuntimeClassName(null)).toBeNull();
        expect(normalizeRuntimeClassName(' kata ')).toBe('kata');
    });
});
