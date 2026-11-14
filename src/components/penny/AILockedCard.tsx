import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AILockedCardProps {
  heading: string;
  body: string;
}

/**
 * Locked state for AI features when write/subscription access has ended.
 * Always shows the feature with a path forward — never a hard wall.
 */
export function AILockedCard({ heading, body }: AILockedCardProps) {
  return (
    <div className="rounded-3xl bg-card border border-primary/20 p-6 shadow-soft text-center max-w-md mx-auto">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-soft flex items-center justify-center mb-3">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h2 className="font-display text-xl font-semibold">{heading}</h2>
      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{body}</p>
      <Button asChild className="mt-4 h-11 rounded-xl w-full">
        <Link to="/pricing">Add a payment method to unlock</Link>
      </Button>
    </div>
  );
}
