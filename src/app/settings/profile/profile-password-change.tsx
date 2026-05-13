'use client';

import { SubmitButton } from "@/components/custom/submit-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model";
import { Input } from "@/components/ui/input";
import { useEffect } from "react";
import { toast } from "sonner";
import { ProfilePasswordChangeModel, profilePasswordChangeZodModel } from "@/shared/model/update-password.model";
import { changePassword } from "./actions";

export default function ProfilePasswordChange() {
    const form = useForm<ProfilePasswordChangeModel>({
        resolver: zodResolver(profilePasswordChangeZodModel)
    });

    const [state, formAction] = useFormState((state: ServerActionResult<any, any>, payload: ProfilePasswordChangeModel) =>
        changePassword(state, payload), FormUtils.getInitialFormState<typeof profilePasswordChangeZodModel>());

    useEffect(() => {
        if (state.status === 'success') {
            toast.success('Password updated successfully');
            form.setValue('oldPassword', '');
            form.setValue('newPassword', '');
            form.setValue('confirmNewPassword', '');
            form.clearErrors();
        }
        FormUtils.mapValidationErrorsToForm<typeof profilePasswordChangeZodModel>(state, form)
    }, [state]);

    const sourceTypeField = form.watch();
    return <>
        <Card>
            <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>Change the password you use to sign in.</CardDescription>
            </CardHeader>
            <Form {...form}>
                <form action={(e) => form.handleSubmit((data) => {
                    return formAction(data);
                })()}>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="oldPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Current password</FormLabel>
                                    <FormControl>
                                        <Input type="password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="newPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New password</FormLabel>
                                    <FormControl>
                                        <Input type="password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="confirmNewPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Confirm new password</FormLabel>
                                    <FormControl>
                                        <Input type="password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                    <CardFooter className="gap-4">
                        <SubmitButton>Change password</SubmitButton>
                        <p className="text-red-500">{state?.message}</p>
                    </CardFooter>
                </form>
            </Form >
        </Card >

    </>;
}