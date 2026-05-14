import { AgentLaunchPlan, AgentLaunchPlanRequest, BuildStrategyRecommendation, PlanEvidence, PlanQuestion, PlanWarning } from "@/shared/model/agent-launch-plan.model";

type EvidenceValue = string | number | boolean | null | undefined;

function evidenceValue(evidence: PlanEvidence): EvidenceValue {
    return typeof evidence.value === 'string' || typeof evidence.value === 'number' || typeof evidence.value === 'boolean' || evidence.value == null
        ? evidence.value
        : undefined;
}

function firstEvidence(evidence: PlanEvidence[], kind: string) {
    return evidence.find(item => item.kind === kind);
}

function allEvidence(evidence: PlanEvidence[], kind: string) {
    return evidence.filter(item => item.kind === kind);
}

class QuickDeployPlanService {
    plan(input: AgentLaunchPlanRequest): AgentLaunchPlan {
        const evidence = input.evidence;
        const flags = input.flags ?? {};
        const serviceRoots = Array.from(new Set(allEvidence(evidence, 'service-root').map(item => {
            const value = evidenceValue(item) ?? item.sourcePath.replace(/\/package\.json$/, '');
            return String(value || '.');
        })));
        const framework = String(evidenceValue(firstEvidence(evidence, 'framework') ?? { value: null } as PlanEvidence) ?? '') || null;
        const outputDir = evidenceValue(firstEvidence(evidence, 'output-dir') ?? { value: undefined } as PlanEvidence) as string | undefined;
        const ports = Array.from(new Set(allEvidence(evidence, 'port').map(item => Number(evidenceValue(item))).filter(port => Number.isInteger(port) && port > 0 && port <= 65535)));
        const hasDockerfile = Boolean(firstEvidence(evidence, 'dockerfile'));
        const hasCompose = Boolean(firstEvidence(evidence, 'compose-file'));
        const hasKubernetes = Boolean(firstEvidence(evidence, 'kubernetes-manifest'));
        const warnings: PlanWarning[] = [];
        const questions: PlanQuestion[] = [];
        const buildStrategies: BuildStrategyRecommendation[] = [];

        if (flags.image) {
            buildStrategies.push({ strategy: 'existing-image', reason: 'An explicit image flag was provided, so no source build is required.', priority: 1 });
        } else if (hasDockerfile) {
            buildStrategies.push({ strategy: 'source-tar', reason: 'A Dockerfile was detected and can be built by the QuickStack managed builder.', priority: 1 });
            buildStrategies.push({ strategy: 'local-docker', reason: 'The same Dockerfile can be built locally if managed upload is unavailable.', priority: 2 });
        } else if (outputDir || framework) {
            buildStrategies.push({ strategy: 'source-tar', reason: 'A static or framework project was detected and can be packaged for a managed build.', priority: 1 });
            buildStrategies.push({ strategy: 'local-docker', reason: 'Local Docker remains available when a generated Dockerfile is preferred.', priority: 2 });
        } else {
            buildStrategies.push({ strategy: 'local-docker', reason: 'No managed source shape was detected; a local image build is the safest fallback.', priority: 1 });
        }

        if (flags.remoteBuilder) {
            warnings.push({ code: 'remote-builder-unavailable', message: 'Remote builder was requested, but this server does not advertise remote-builder capability yet.' });
        }
        if (serviceRoots.length > 1 && !flags.serviceRoot) {
            questions.push({
                id: 'service-root',
                prompt: 'Which detected service root should QuickStack deploy?',
                options: serviceRoots.map(root => ({ value: root, label: root })),
            });
        }
        if (hasCompose) {
            questions.push({ id: 'compose-import', prompt: 'A Compose file was detected. Confirm whether to import services as separate QuickStack apps.' });
        }
        if (hasKubernetes) {
            warnings.push({ code: 'kubernetes-manifest-detected', message: 'Kubernetes manifests were detected. QuickStack will only translate safe app-level intent.' });
        }
        if (ports.length === 0 && !flags.image) {
            questions.push({ id: 'port', prompt: 'Which container port should QuickStack expose?' });
        }

        return {
            framework,
            serviceRoot: flags.serviceRoot || serviceRoots[0] || '.',
            ports: ports.length > 0 ? ports : [],
            outputDir,
            evidence,
            buildStrategies: buildStrategies.sort((left, right) => left.priority - right.priority),
            questions,
            warnings,
        };
    }
}

const quickDeployPlanService = new QuickDeployPlanService();
export default quickDeployPlanService;
