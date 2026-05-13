import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ResponseTableRow {
  id: string;
  values: string[];
}

interface ResponseTableProps {
  headers: string[];
  rows: ResponseTableRow[];
}

export function ResponseTable({ headers, rows }: ResponseTableProps) {
  const headerCounts = new Map<string, number>();
  const headerEntries = headers.map((header) => {
    const nextCount = (headerCounts.get(header) ?? 0) + 1;
    headerCounts.set(header, nextCount);
    return { label: header, key: `${header}-${nextCount}` };
  });

  return (
    <div className="overflow-x-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            {headerEntries.map((entry) => (
              <TableHead key={entry.key}>{entry.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={headers.length}
                className="text-center text-muted-foreground"
              >
                データがありません
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {headerEntries.map((entry, headerIndex) => (
                  <TableCell key={`${row.id}-${entry.key}`}>
                    {row.values[headerIndex] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
