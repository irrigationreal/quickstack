import quickStackManagedService from "./quickstack-managed-service";

const postgresService = {
    status: (appId: string) => quickStackManagedService.getManagedStatus('postgres', appId),
};

export default postgresService;
