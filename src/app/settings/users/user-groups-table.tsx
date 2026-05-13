'use client';

import { Button } from "@/components/ui/button";
import { EditIcon, Plus, TrashIcon } from "lucide-react";
import { Toast } from "@/frontend/utils/toast.utils";
import { useConfirmDialog } from "@/frontend/states/zustand.states";
import React from "react";
import { SimpleDataTable } from "@/components/custom/simple-data-table";
import { formatDateTime } from "@/frontend/utils/format.utils";
import { deleteRole } from "./actions";
import { adminRoleName } from "@/shared/model/role-extended.model";
import RoleEditOverlay from "./user-group-edit-overlay";
import { ProjectExtendedModel } from "@/shared/model/project-extended.model";
import { UserGroupExtended } from "@/shared/model/sim-session.model";

export default function UserGroupsTable({ userGroups, projects }: {
    userGroups: UserGroupExtended[];
    projects: ProjectExtendedModel[];
}) {

    const { openConfirmDialog: openDialog } = useConfirmDialog();

    const asyncDeleteItem = async (id: string) => {
        const confirm = await openDialog({
            title: "Delete group",
            description: "Do you want to delete this group? Users in this group will lose their assigned role and will not be able to use QuickStack until you assign them to a new group.",
            okButton: "Delete",
        });
        if (confirm) {
            await Toast.fromAction(() => deleteRole(id), 'Deleting group...', 'Group deleted successfully.');
        }
    };

    return <>
        <SimpleDataTable columns={[
            ['id', 'ID', false],
            ['name', 'Name', true],
            ["createdAt", "Created at", true, (item) => formatDateTime((item as any).createdAt)],
            ["updatedAt", "Updated at", false, (item) => formatDateTime((item as any).updatedAt)],
        ]}
            data={userGroups}
            actionCol={(item) =>
                <>
                    <div className="flex">
                        {item.name !== adminRoleName && <>
                            <div className="flex-1"></div>
                            <RoleEditOverlay projects={projects} userGroup={item} >
                                <Button variant="ghost"><EditIcon /></Button>
                            </RoleEditOverlay>
                            <Button variant="ghost" onClick={() => asyncDeleteItem(item.id)}>
                                <TrashIcon />
                            </Button>
                        </>}
                    </div>
                </>}
        />
        <RoleEditOverlay projects={projects} >
            <Button variant="secondary"><Plus /> Create Group</Button>
        </RoleEditOverlay>
    </>;
}