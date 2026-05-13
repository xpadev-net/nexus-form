interface ResponseDisplayProps {
  label: string;
  value: string;
}

export function ResponseDisplay({ label, value }: ResponseDisplayProps) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
    </div>
  );
}
