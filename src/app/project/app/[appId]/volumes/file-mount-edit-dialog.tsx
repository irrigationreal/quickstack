'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useFormState } from 'react-dom'
import { useEffect, useState } from "react";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { SubmitButton } from "@/components/custom/submit-button";
import { AppFileMount } from "@prisma/client"
import { ServerActionResult } from "@/shared/model/server-action-error-return.model"
import { saveFileMount } from "./actions"
import { toast } from "sonner"
import { AppExtendedModel } from "@/shared/model/app-extended.model"
import { FileMountEditModel, fileMountEditZodModel } from "@/shared/model/file-mount-edit.model"
import { Textarea } from "@/components/ui/textarea"

export default function FileMountEditDialog({ children, fileMount, app }: { children: React.ReactNode; fileMount?: AppFileMount; app: AppExtendedModel; }) {

  const [isOpen, setIsOpen] = useState<boolean>(false);


  const form = useForm<FileMountEditModel>({
    resolver: zodResolver(fileMountEditZodModel),
    defaultValues: {
      ...fileMount,
    }
  });

  const [state, formAction] = useFormState((state: ServerActionResult<any, any>, payload: FileMountEditModel) =>
    saveFileMount(state, {
      ...payload,
      appId: app.id,
      id: fileMount?.id
    }), FormUtils.getInitialFormState<typeof fileMountEditZodModel>());

  useEffect(() => {
    if (state.status === 'success') {
      form.reset();
      toast.success('File mount saved successfully.', {
        description: 'Click "Deploy" to apply the changes to your app.',
      });
      setIsOpen(false);
    }
    FormUtils.mapValidationErrorsToForm<typeof fileMountEditZodModel>(state, form);
  }, [state]);

  useEffect(() => {
    form.reset(fileMount);
  }, [fileMount]);

  return (
    <>
      <div onClick={() => setIsOpen(true)}>
        {children}
      </div>
      <Dialog open={!!isOpen} onOpenChange={(isOpened) => setIsOpen(false)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit file mount</DialogTitle>
            <DialogDescription>
              Configure the file mount. Its contents will be available in the container at the mount path you choose.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form action={(e) => form.handleSubmit((data) => {
              return formAction(data);
            })()}>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="containerMountPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Container mount path</FormLabel>
                      <FormControl>
                        <Input placeholder="ex. /data/my-config.txt" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>File content</FormLabel>
                      <FormControl>
                        <Textarea rows={10} placeholder="Write your file content here..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-red-500">{state.message}</p>
                <SubmitButton>Save</SubmitButton>
              </div>
            </form>
          </Form >
        </DialogContent>
      </Dialog>
    </>
  )



}