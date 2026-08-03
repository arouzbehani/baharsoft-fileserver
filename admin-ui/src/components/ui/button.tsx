import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-teal-600 text-white shadow-sm hover:bg-teal-700",
        secondary: "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
      },
      size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
