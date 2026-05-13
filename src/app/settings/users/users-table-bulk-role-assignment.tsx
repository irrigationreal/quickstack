'use client';

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { UserExtended } from "@/shared/model/user-extended.model";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Toast } from "@/frontend/utils/toast.utils";
import { assignRoleToUsers } from "./actions";
import { UserGroupExtended } from "@/shared/model/sim-session.model";

interface UsersBulkRoleAssignmentProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    selectedUsers: UserExtended[];
    userGroups: UserGroupExtended[];
}

export default function UsersBulkRoleAssignment({
    isOpen,
    onOpenChange,
    selectedUsers,
    userGroups
}: UsersBulkRoleAssignmentProps) {
    const [selectedGroup, setSelectedGroup] = useState<string>("");
    const selectedUsersLabel = `${selectedUsers.length} user${selectedUsers.length === 1 ? '' : 's'}`;

    const handleAssignGroup = async () => {
        if (!selectedGroup) {
            toast.error("Please select a group.");
            return;
        }

        await Toast.fromAction(() => assignRoleToUsers(selectedUsers.map(u => u.id), selectedGroup), `Assigned a group to ${selectedUsersLabel}.`, 'Assigning group...');
        onOpenChange(false);
        setSelectedGroup("");
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign group</DialogTitle>
                    <DialogDescription>
                        Select a group to assign to {selectedUsersLabel}.
                    </DialogDescription>
                </DialogHeader>
                <Select onValueChange={setSelectedGroup} value={selectedGroup}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select a group" />
                    </SelectTrigger>
                    <SelectContent>
                        {userGroups.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                                {role.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleAssignGroup}>Assign</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
