interface Props {
  title?: string;
  description?: string;
}

export function FormNotFoundPage({
  title = "フォームが見つかりません",
  description = "このフォームは存在しないか、現在公開されていません。",
}: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm">
        <p className="text-6xl font-bold text-muted-foreground/30">404</p>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
