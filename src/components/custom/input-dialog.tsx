'use client'

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import React, { useEffect } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useInputDialog } from "@/frontend/states/zustand.states";

export function InputDialog() {
  const { isDialogOpen, data, closeDialog } = useInputDialog();
  const [inputValue, setInputValue] = React.useState<string>(data?.inputValue ?? '');

  useEffect(() => {
    setInputValue(data?.inputValue ?? '');
  }, [data]);

  if (!data) {
    return <></>;
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={() => closeDialog()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{data.title}</DialogTitle>
          {data.description && <DialogDescription>
            {data.description}
          </DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            {data.fieldName && <Label htmlFor="input-dialog-value" className="text-right">
              {data.fieldName}
            </Label>}
            <Input
              id="input-dialog-value"
              aria-label={data.fieldName ?? data.title}
              placeholder={data.placeholder ?? data.fieldName}
              value={inputValue}
              onKeyUp={(key) => {
                if (key.key === 'Enter' && inputValue) {
                  closeDialog(inputValue);
                }
              }}
              onChange={(e) => setInputValue(e.target.value)}
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!inputValue) return;
            closeDialog(inputValue)
          }}>{data.okButton ?? 'OK'}</Button>
          <Button variant="secondary" onClick={() => closeDialog(undefined)}>{data.cancelButton ?? 'Cancel'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
