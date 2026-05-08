import { V1RuntimeClassList } from "@kubernetes/client-node";
import k3s from "../adapter/kubernetes-api.adapter";
import { ServiceException } from "@/shared/model/service.exception.model";
import { RuntimeClassInfoModel } from "@/shared/model/runtime-class-settings.model";

class RuntimeClassService {
    async getRuntimeClasses(): Promise<RuntimeClassInfoModel[]> {
        const response = await k3s.node.listRuntimeClass() as { body: V1RuntimeClassList };
        return response.body.items
            .map(runtimeClass => ({
                name: runtimeClass.metadata?.name ?? '',
                handler: runtimeClass.handler,
                hasScheduling: !!runtimeClass.scheduling,
                hasOverhead: !!runtimeClass.overhead,
            }))
            .filter(runtimeClass => runtimeClass.name.length > 0);
    }

    async assertRuntimeClassExists(runtimeClassName: string): Promise<void> {
        try {
            await k3s.node.readRuntimeClass(runtimeClassName);
        } catch (error) {
            console.error(`RuntimeClass ${runtimeClassName} is not available in this cluster.`, error);
            throw new ServiceException(`RuntimeClass "${runtimeClassName}" is not available in this cluster. The RuntimeClass must already exist and its handler must be configured on eligible nodes.`);
        }
    }
}

const runtimeClassService = new RuntimeClassService();
export default runtimeClassService;
