import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" />
    <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-white/60 bg-white p-6 shadow-2xl", className)} {...props}>
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="size-4" /></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
