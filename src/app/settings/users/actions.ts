'use server'

import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import { getAdminUserSession, getAuthUserSession, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import userService from "@/server/services/user.service";
import { UserEditModel, userEditZodModel } from "@/shared/model/user-edit.model";
import userGroupService from "@/server/services/user-group.service";
import { RoleEditModel, roleEditZodModel } from "@/shared/model/role-edit.model";
import { adminRoleName } from "@/shared/model/role-extended.model";
import auditService, { auditActorFromSession } from "@/server/services/audit.service";

export const saveUser = async (prevState: any, inputData: UserEditModel) =>
    saveFormAction(inputData, userEditZodModel, async (validatedData) => {
        const session = await getAdminUserSession();
        const { email } = session;
        if (validatedData.email === email) {
            throw new ServiceException('Please edit your profile in the profile settings');
        }
        if (validatedData.id) {
            if (!!validatedData.newPassword) {
                await userService.changePasswordImediately(validatedData.email, validatedData.newPassword);
            }
            await userService.updateUser({
                userGroupId: validatedData.userGroupId,
                email: validatedData.email
            });
        } else {
            if (!validatedData.newPassword || validatedData.newPassword.split(' ').join('').length === 0) {
                throw new ServiceException('The password is required');
            }
            await userService.registerUser(validatedData.email, validatedData.newPassword, validatedData.userGroupId);
        }
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: validatedData.id ? "USER_UPDATE" : "USER_CREATE",
            outcome: "SUCCESS",
            targetType: "USER",
            targetId: validatedData.id,
            metadata: {
                targetEmail: validatedData.email,
                changedFields: ["email", "userGroupId", ...(validatedData.newPassword ? ["password"] : [])],
            },
        });
        return new SuccessActionResult();
    });

export const saveRole = async (prevState: any, inputData: RoleEditModel) =>
    saveFormAction(inputData, roleEditZodModel, async (validatedData) => {
        const session = await getAdminUserSession();
        await userGroupService.saveWithPermissions(validatedData);
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: validatedData.id ? "ROLE_UPDATE" : "ROLE_CREATE",
            outcome: "SUCCESS",
            targetType: "ROLE",
            targetId: validatedData.id,
            metadata: { roleName: validatedData.name, changedFields: Object.keys(validatedData) },
        });
        return new SuccessActionResult();
    });

export const deleteUser = async (userId: string) =>
    simpleAction(async () => {
        const session = await getAdminUserSession();
        const user = await userService.getUserById(userId);
        if (user.email === session.email) {
            throw new ServiceException('You cannot delete your own user');
        }
        if (user.userGroup?.name === adminRoleName) {
            throw new ServiceException('You cannot delete users with the group "admin"');
        }
        await userService.deleteUserById(userId);
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: "USER_DELETE",
            outcome: "SUCCESS",
            targetType: "USER",
            targetId: userId,
            metadata: { targetEmail: user.email },
        });
        return new SuccessActionResult();
    });

export const assignRoleToUsers = async (userIds: string[], userGroupId: string) =>
    simpleAction(async () => {
        const session = await getAdminUserSession();
        const users = await userService.getAllUsers();
        for (const user of users) {
            if (userIds.includes(user.id)) {
                user.userGroupId = userGroupId;
            }
        }

        // check if there are any admin users left
        const adminRole = await userGroupService.getOrCreateAdminRole();
        if (!users.some(user => user.userGroupId === adminRole.id)) {
            throw new ServiceException('You cannot perform this group assignment, because there are no admin users left after this operation.');
        }

        // save all users with new role
        const relevantUsers = users.filter(user => userIds.includes(user.id));
        for (const user of relevantUsers) {
            await userGroupService.assignUserToRole(user.id, userGroupId);
        }
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: "USER_ROLE_ASSIGNMENT",
            outcome: "SUCCESS",
            targetType: "ROLE",
            targetId: userGroupId,
            metadata: { userCount: relevantUsers.length },
        });

        return new SuccessActionResult();
    });

export const deleteRole = async (roleId: string) =>
    simpleAction(async () => {
        const session = await getAdminUserSession();
        await userGroupService.deleteById(roleId);
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: "ROLE_DELETE",
            outcome: "SUCCESS",
            targetType: "ROLE",
            targetId: roleId,
        });
        return new SuccessActionResult();
    });