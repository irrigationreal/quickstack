import quickStackManagedService from "./quickstack-managed-service";

const mysqlService = {
    status: (appId: string) => quickStackManagedService.getManagedStatus('mysql', appId),
};

export default mysqlService;
