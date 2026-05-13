import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppExtendedModel } from "@/shared/model/app-extended.model";
import { useEffect, useState } from "react";
import { DatabaseTemplateInfoModel } from "@/shared/model/database-template-info.model";
import { Actions } from "@/frontend/utils/nextjs-actions.utils";
import { getDatabaseCredentials } from "./actions";
import CopyInputField from "@/components/custom/copy-input-field";
import FullLoadingSpinner from "@/components/ui/full-loading-spinnter";

export default function DbCredentials({
    app
}: {
    app: AppExtendedModel;
}) {

    const [databaseCredentials, setDatabaseCredentials] = useState<DatabaseTemplateInfoModel | undefined>(undefined);


    const loadCredentials = async (appId: string) => {
        const response = await Actions.run(() => getDatabaseCredentials(appId));
        setDatabaseCredentials(response);
    }

    useEffect(() => {
        loadCredentials(app.id);
        return () => {
            setDatabaseCredentials(undefined);
        }
    }, [app]);

    return <>
        <Card>
            <CardHeader>
                <CardTitle>Database credentials</CardTitle>
                <CardDescription>Use these credentials to connect to the database from other apps in the same project.</CardDescription>
            </CardHeader>
            <CardContent>
                {!databaseCredentials ? <FullLoadingSpinner /> : <>
                    <div className="grid grid-cols-2 gap-4">
                        {!!databaseCredentials?.databaseName && <>   <CopyInputField
                            label="Database name"
                            value={databaseCredentials?.databaseName || ''} />

                            <div></div>
                        </>}

                        {!!databaseCredentials?.username && <CopyInputField
                            label="Username"
                            value={databaseCredentials?.username || ''} />}

                        {!!databaseCredentials?.password && <CopyInputField
                            label="Password"
                            secret={true}
                            value={databaseCredentials?.password || ''} />}

                        <CopyInputField
                            label="Internal hostname"
                            value={databaseCredentials?.hostname || ''} />

                        <CopyInputField
                            label="Internal port"
                            value={(databaseCredentials?.port + '')} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 pt-4">
                        <CopyInputField
                            label="Internal connection URL"
                            secret={true}
                            value={databaseCredentials?.internalConnectionUrl || ''} />
                    </div>
                </>}
            </CardContent>
        </Card>
    </>;
}
