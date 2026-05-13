import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppExtendedModel } from "@/shared/model/app-extended.model";
import DbGateDbTool from "./db-gate-db-tool";
import DbToolSwitch from "./phpmyadmin-db-tool";

export default function DbToolsCard({
    app
}: {
    app: AppExtendedModel;
}) {

    if (app.appType === 'REDIS') {
        return <></>;
    }

    return <>
        <Card>
            <CardHeader>
                <CardTitle>Database access</CardTitle>
                <CardDescription>Enable one of these tools to access the database in your browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <DbGateDbTool app={app} />
                {['MYSQL', 'MARIADB'].includes(app.appType) && <DbToolSwitch app={app} toolId="phpmyadmin"
                    toolNameString="phpMyAdmin" />}
                {app.appType === 'POSTGRES' && <DbToolSwitch app={app} toolId="pgadmin" toolNameString="pgAdmin" />}
            </CardContent>
        </Card >
    </>;
}
