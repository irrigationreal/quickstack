import quickStackManagedService from "./quickstack-managed-service";

const redisService = {
    status: (appId: string) => quickStackManagedService.getManagedStatus('redis', appId),
};

export default redisService;
