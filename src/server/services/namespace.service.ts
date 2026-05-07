import k3s from "../adapter/kubernetes-api.adapter";
import { V1NamespaceList } from "@kubernetes/client-node";
import { Constants } from "../../shared/utils/constants";

class NamespaceService {

    async getNamespaces(): Promise<string[]> {
        const k3sResponse = await k3s.core.listNamespace() as { body: V1NamespaceList };
        return k3sResponse.body.items.map((item) => item.metadata?.name).filter((name): name is string => !!name);
    }

    async createNamespaceIfNotExists(namespace: string) {
        const existingNamespaces = await this.getNamespaces();
        if (existingNamespaces.includes(namespace)) {
            return;
        }
        await k3s.core.createNamespace({
            metadata: {
                name: namespace,
                annotations: {
                    [Constants.QS_ANNOTATION_PROJECT_ID]: namespace
                }
            }
        });
    }

    async deleteNamespace(namespace: string) {
        const nameSpaces = await this.getNamespaces();
        if (nameSpaces.includes(namespace)) {
            await k3s.core.deleteNamespace(namespace);
        }
    }


}

const namespaceService = new NamespaceService();
export default namespaceService;
