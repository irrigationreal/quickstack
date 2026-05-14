'use client' // Error boundaries must be Client Components

import { Button } from "@/components/ui/button"
import { cn } from "@/frontend/utils/utils";
import { AlertCircle } from "lucide-react"
import { Inter } from "next/font/google";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-sans",
});

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <html >
            <body className={cn(
                "min-h-screen bg-background font-sans antialiased",
                inter.variable
            )}>
                <div className="flex h-screen w-full flex-col items-center justify-center space-y-4 bg-background p-4 text-foreground">
                    <div className="flex max-w-md flex-col items-center justify-center space-y-2 text-center">
                        <div className="rounded-full bg-destructive/10 p-3">
                            <AlertCircle className="h-8 w-8 text-destructive" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight">Something went wrong</h2>
                        <p className="mt-4 text-muted-foreground">
                            An unexpected error occurred. Please check whether you are authorized for this action and try again.
                        </p>
                        <p className="text-xs text-muted-foreground mt-6">
                            Digest: {error.digest}
                        </p>
                    </div>
                </div>
            </body>
        </html>
    )
}