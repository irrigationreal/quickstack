import { Prisma, RoleAppPermission, UserGroup } from "@prisma/client";
import dataAccess from "../adapter/db.client";
import { revalidateTag, unstable_cache } from "next/cache";
import { Tags } from "../utils/cache-tag-generator.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { RoleEditModel } from "@/shared/model/role-edit.model";
import { adminRoleName } from "@/shared/model/role-extended.model";
import { UserGroupExtended } from "@/shared/model/sim-session.model";

export class UserGroupService {

    async getRoleByUserMail(email: string): Promise<UserGroupExtended | null> {
        return await unstable_cache(async (mail: string) => await dataAccess.client.user.findFirst({
            select: {
                userGroup: {
                    select: {
                        name: true,
                        id: true,
                        canAccessBackups: true,
                        roleProjectPermissions: {
                            select: {
                                projectId: true,
                                project: {
                                    select: {
                                        apps: {
                                            select: {
                                                id: true,
                                                name: true,
                                            }
                                        }
                                    }
                                },
                                createApps: true,
                                deleteApps: true,
                                writeApps: true,
                                readApps: true,
                                roleAppPermissions: true,
                            }
                        }
                    }
                }
            },
            where: {
                email: mail
            }
        }).then(user => {
            return user?.userGroup ?? null;
        }),
            [Tags.userGroups(), Tags.users()], {
            tags: [Tags.userGroups(), Tags.users()]
        })(email);
    }

    async saveWithPermissions(item: RoleEditModel) {
        try {
            if (item.name === adminRoleName) {
                throw new ServiceException("You cannot assign the name 'admin' to a role");
            }
            await dataAccess.client.$transaction(async tx => {
                // save role first

                let savedRole: UserGroup;
                if (item.id) {
                    savedRole = await tx.userGroup.update({
                        where: {
                            id: item.id as string
                        },
                        data: {
                            name: item.name,
                            canAccessBackups: item.canAccessBackups,
                        }
                    });
                } else {
                    savedRole = await tx.userGroup.create({
                        data: {
                            name: item.name,
                            canAccessBackups: item.canAccessBackups,
                        }
                    });
                }

                // save project and app permissions

                await tx.roleProjectPermission.deleteMany({
                    where: {
                        userGroupId: savedRole.id
                    }
                });

                for (let projectRolePermission of item.roleProjectPermissions) {
                    const forThisProjectCustomAppRolesExist = projectRolePermission.roleAppPermissions.length > 0;
                    const projectRolePermissionData = {
                        userGroupId: savedRole.id,
                        projectId: projectRolePermission.projectId,
                        createApps: forThisProjectCustomAppRolesExist ? false : projectRolePermission.createApps,
                        deleteApps: forThisProjectCustomAppRolesExist ? false : projectRolePermission.deleteApps,
                        writeApps: forThisProjectCustomAppRolesExist ? false : projectRolePermission.writeApps,
                        readApps: projectRolePermission.readApps
                    };
                    const savedProjectRolePermission = await tx.roleProjectPermission.create({
                        data: projectRolePermissionData
                    });

                    // save app permissions
                    await tx.roleAppPermission.deleteMany({
                        where: {
                            roleProjectPermissionId: savedProjectRolePermission.id
                        }
                    });

                    await tx.roleAppPermission.createMany({
                        data: projectRolePermission.roleAppPermissions.map((app) => ({
                            ...app,
                            roleProjectPermissionId: savedProjectRolePermission.id
                        }))
                    });
                }
            });
        } finally {
            revalidateTag(Tags.userGroups());
            revalidateTag(Tags.users());
        }
    }

    async save(item: Prisma.UserGroupUncheckedCreateInput | Prisma.UserGroupUncheckedUpdateInput) {
        try {
            if (item.name === adminRoleName) {
                throw new ServiceException("You cannot assign the name 'admin' to a role");
            }
            if (item.id) {
                await dataAccess.client.userGroup.update({
                    where: {
                        id: item.id as string
                    },
                    data: item
                });
            } else {
                await dataAccess.client.userGroup.create({
                    data: item as Prisma.UserGroupUncheckedCreateInput
                });
            }
        } finally {
            revalidateTag(Tags.userGroups());
            revalidateTag(Tags.users());
        }
    }

    async getAll(): Promise<UserGroupExtended[]> {
        return await unstable_cache(async () => await dataAccess.client.userGroup.findMany({
            include: {
                roleProjectPermissions: {
                    select: {
                        projectId: true,
                        project: {
                            select: {
                                apps: {
                                    select: {
                                        id: true,
                                        name: true,
                                    }
                                }
                            }
                        },
                        createApps: true,
                        deleteApps: true,
                        writeApps: true,
                        readApps: true,
                        roleAppPermissions: true,
                    }
                }
            }
        }),
            [Tags.userGroups()], {
            tags: [Tags.userGroups()]
        })();
    }
    async getById(id: string): Promise<UserGroup> {
        return await unstable_cache(async () => await dataAccess.client.userGroup.findFirstOrThrow({
            where: {
                id
            },
            include: {
                roleProjectPermissions: {
                    select: {
                        projectId: true,
                        project: {
                            select: {
                                apps: {
                                    select: {
                                        id: true,
                                        name: true,
                                    }
                                }
                            }
                        },
                        createApps: true,
                        deleteApps: true,
                        writeApps: true,
                        readApps: true,
                        roleAppPermissions: true,
                    }
                }
            }
        }),
            [Tags.userGroups(), id], {
            tags: [Tags.userGroups()]
        })();
    }

    async assignUserToRole(userId: string, userGroupId: string) {
        try {
            await dataAccess.client.user.update({
                where: {
                    id: userId,
                },
                data: {
                    userGroupId,
                },
            });
        } finally {
            revalidateTag(Tags.userGroups());
            revalidateTag(Tags.users());
        }
    }

    async deleteById(id: string) {
        try {
            await dataAccess.client.userGroup.delete({
                where: {
                    id
                }
            });
        } finally {
            revalidateTag(Tags.userGroups());
            revalidateTag(Tags.users());
        }
    }

    async getOrCreateAdminRole() {
        let adminRole = await dataAccess.client.userGroup.findFirst({
            where: {
                name: adminRoleName
            }
        });
        if (!adminRole) {
            adminRole = await dataAccess.client.userGroup.create({
                data: {
                    name: adminRoleName
                }
            });
        }
        return adminRole;
    }

    async createDefaultRolesIfNotExists() {
        const dbAdminRole = await dataAccess.client.userGroup.findFirst({
            where: {
                name: {
                    in: [adminRoleName]
                }
            },
            include: {
                users: true
            }
        });
        if (!dbAdminRole) {
            console.warn("*** No admin users found. Creating default admin role ***");
            const adminRole = await this.getOrCreateAdminRole();
            await dataAccess.client.user.updateMany({
                where: {
                    userGroupId: null
                },
                data: {
                    userGroupId: adminRole.id
                }
            });
            return;
        }

        if (dbAdminRole.users.length === 0) {
            // making all users to admins
            console.warn("*** No admin users found. Assigning all users to admin role ***");
            const adminRole = await this.getOrCreateAdminRole();
            await dataAccess.client.user.updateMany({
                data: {
                    userGroupId: adminRole.id
                }
            });
        }
    }
}

const userGroupService = new UserGroupService();
export default userGroupService;