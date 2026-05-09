import { RoleAppPermission, User, UserGroup } from "@prisma/client";

export type RoleExtended = UserGroup & {
    roleAppPermissions: (RoleAppPermission & {
        app: {
            name: string;
        };
    })[];
}

export enum RolePermissionEnum {
    READ = 'READ',
    READWRITE = 'READWRITE'
}


export const adminRoleName = "admin";