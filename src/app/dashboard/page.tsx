import { Empty, PageHeader } from "@/components/ui";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Dropout patterns for leadership: by city and by cook, last 30 days." />
      <Empty>Metrics are being defined. This page will show dropout frequency by city and by cook.</Empty>
    </div>
  );
}
