import { AppExtendedModel } from "@/shared/model/app-extended.model";
import { KubeObjectNameUtils } from "./kube-object-name.utils";

export class EnvVarUtils {
    static parseEnvVariables(app: AppExtendedModel): Array<{ name: string; value?: string; valueFrom?: { secretKeyRef: { name: string; key: string } } }> {
        const publicEnvVars = app.envVars ? app.envVars.split('\n').filter(x => !!x).map(env => {
            const [name] = env.split('=');
            const value = env.replace(`${name}=`, '');
            return { name, value };
        }) : [];

        const secretEnvVars = (app.appSecretEnvVars ?? []).map(secretEnvVar => ({
            name: secretEnvVar.name,
            valueFrom: {
                secretKeyRef: {
                    name: KubeObjectNameUtils.toAppSecretEnvVarsName(app.id),
                    key: secretEnvVar.name,
                }
            }
        }));

        return [...publicEnvVars, ...secretEnvVars];
    }
}