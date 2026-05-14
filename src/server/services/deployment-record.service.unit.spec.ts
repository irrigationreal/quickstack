import deploymentRecordService from './deployment-record.service';

describe('deployment record rollout state mapping', () => {
    it('maps pending replicas with progressing condition to progressing', () => {
        const result = deploymentRecordService.rolloutState({ status: { replicas: 1, readyReplicas: 0, conditions: [{ type: 'Progressing', status: 'True', message: 'rolling out' }] } }, 1);
        expect(result.state).toBe('progressing');
    });

    it('maps ready replicas with available condition to healthy', () => {
        const result = deploymentRecordService.rolloutState({ status: { replicas: 2, readyReplicas: 2, conditions: [{ type: 'Available', status: 'True' }] } }, 2);
        expect(result.state).toBe('healthy');
    });

    it('maps ProgressDeadlineExceeded to timed_out', () => {
        const result = deploymentRecordService.rolloutState({ status: { replicas: 1, readyReplicas: 0, conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' }] } }, 1);
        expect(result.state).toBe('timed_out');
    });

    it('maps CrashLoopBackOff pods to failed', () => {
        const result = deploymentRecordService.rolloutState({ status: { replicas: 1, readyReplicas: 0, conditions: [] } }, 1, [{ status: 'CrashLoopBackOff' }]);
        expect(result.state).toBe('failed');
    });
});
