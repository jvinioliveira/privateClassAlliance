import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { getMonthReport } from '@/hooks/useSupabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BarChart3, TrendingUp, UserX, XCircle, CheckCircle } from 'lucide-react';

type ReportData = {
  total_booked: number;
  total_completed: number;
  total_no_show: number;
  total_cancelled: number;
  occupation_rate: number;
};

const isReportData = (value: unknown): value is ReportData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.total_booked === 'number' &&
    typeof candidate.total_completed === 'number' &&
    typeof candidate.total_no_show === 'number' &&
    typeof candidate.total_cancelled === 'number' &&
    typeof candidate.occupation_rate === 'number'
  );
};

const AdminReportsPage = () => {
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [report, setReport] = useState<ReportData | null>(null);

  const reportMutation = useMutation({
    mutationFn: () => getMonthReport(`${monthInput}-01`),
    onSuccess: (data) => {
      setReport(isReportData(data) ? data : null);
    },
    onError: () => setReport(null),
  });

  const cards = report
    ? [
        { label: 'Agendadas', value: report.total_booked, icon: BarChart3, color: 'text-primary' },
        { label: 'Concluídas', value: report.total_completed, icon: CheckCircle, color: 'text-green-500' },
        { label: 'Faltas', value: report.total_no_show, icon: UserX, color: 'text-destructive' },
        { label: 'Canceladas', value: report.total_cancelled, icon: XCircle, color: 'text-muted-foreground' },
        { label: 'Taxa de ocupação', value: `${report.occupation_rate}%`, icon: TrendingUp, color: 'text-primary' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Relatório mensal</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1 flex-1">
          <Label>Mês</Label>
          <Input
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
            className="bg-card"
          />
        </div>
        <Button
          onClick={() => reportMutation.mutate()}
          disabled={reportMutation.isPending}
          className="w-full font-display uppercase sm:w-auto"
        >
          {reportMutation.isPending ? 'Carregando...' : 'Gerar'}
        </Button>
      </div>

      {report && (
        <div className="grid grid-cols-1 gap-3 animate-fade-in sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-4 text-center">
              <card.icon className={`mx-auto h-5 w-5 ${card.color} mb-2`} />
              <p className="text-2xl font-bold font-display">{card.value}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{card.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminReportsPage;
