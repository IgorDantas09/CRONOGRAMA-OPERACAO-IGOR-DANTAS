import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type OperationType = 'ADUBACAO' | 'PULVERIZACAO' | 'COLHEITA';
type GroupBy = 'DIVISAO' | 'FAZENDA' | 'VARIEDADE' | 'GERAL';

type PlantingRow = {
  divisao: string;
  safra: string;
  anoAgricola: string;
  cultura: string;
  fazenda: string;
  talhao: string;
  variedade: string;
  dataPlantio: Date;
  areaTotal: number;
  areaPlantada: number;
};

type FieldSummary = {
  id: string;
  divisao: string;
  fazenda: string;
  talhao: string;
  variedade: string;
  areaTotal: number;
  thresholdArea: number;
  plantingDate: Date;
};

type VarietyConfig = {
  germinationDays: number;
  cycleDays: number;
};

type OperationItem = {
  id: string;
  product: string;
  dae: number;
};

type MachineItem = {
  id: string;
  model: string;
  quantity: number;
  haPerDay: number;
};

type DemandPoint = {
  date: string;
  demand: number;
  cumulativeDemand: number;
  capacity: number;
  backlog: number;
  machinesNeeded: number;
};

type ScenarioResult = {
  groupName: string;
  totalArea: number;
  maxBacklog: number;
  firstDemandDate?: string;
  lastDemandDate?: string;
  dailyCapacity: number;
  points: DemandPoint[];
};

type AlertPeriod = {
  status: 'ATENDE' | 'NAO_ATENDE';
  start: string;
  end: string;
  maxBacklog: number;
  impactedArea: number;
};

const REQUIRED_COLUMNS = [
  'Divisão',
  'Safra',
  'Ano Agrícola',
  'Cultura',
  'Fazenda',
  'Talhão',
  'Variedade',
  'Data Plantio',
  'Área Total(ha)',
  'Área Plantada(ha)',
];

const OPERATION_LABEL: Record<OperationType, string> = {
  ADUBACAO: 'Adubação',
  PULVERIZACAO: 'Pulverização',
  COLHEITA: 'Colheita',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const normalized = text.includes(',') && text.includes('.')
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function excelDateToJs(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const iso = new Date(text);
  if (!Number.isNaN(iso.getTime())) return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
  const parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts) {
    return new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
  }
  return null;
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return '-';
  const value = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  if (Number.isNaN(value.getTime())) return '-';
  return value.toLocaleDateString('pt-BR');
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function toIsoDate(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return new Date(copy.getFullYear(), copy.getMonth(), copy.getDate());
}

function readWorkbook(file: File): Promise<PlantingRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
          header: 1,
          raw: true,
          defval: '',
        });
        const headerRowIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === 'divisao'));
        if (headerRowIndex < 0) {
          reject(new Error('Cabeçalho não encontrado.'));
          return;
        }
        const headers = rows[headerRowIndex].map(normalizeHeader);
        const requiredMissing = REQUIRED_COLUMNS.filter((col) => !headers.includes(normalizeHeader(col)));
        if (requiredMissing.length) {
          reject(new Error(`Faltam colunas obrigatórias: ${requiredMissing.join(', ')}`));
          return;
        }

        const indexOf = (label: string) => headers.indexOf(normalizeHeader(label));
        const parsed: PlantingRow[] = rows
          .slice(headerRowIndex + 1)
          .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
          .map((row) => {
            const date = excelDateToJs(row[indexOf('Data Plantio')]);
            return {
              divisao: String(row[indexOf('Divisão')] ?? '').trim(),
              safra: String(row[indexOf('Safra')] ?? '').trim(),
              anoAgricola: String(row[indexOf('Ano Agrícola')] ?? '').trim(),
              cultura: String(row[indexOf('Cultura')] ?? '').trim(),
              fazenda: String(row[indexOf('Fazenda')] ?? '').trim(),
              talhao: String(row[indexOf('Talhão')] ?? '').trim(),
              variedade: String(row[indexOf('Variedade')] ?? '').trim(),
              dataPlantio: date ?? new Date('1970-01-01'),
              areaTotal: toNumber(row[indexOf('Área Total(ha)')]),
              areaPlantada: toNumber(row[indexOf('Área Plantada(ha)')]),
            };
          })
          .filter((row) => row.talhao && row.variedade && row.areaTotal > 0 && row.areaPlantada >= 0 && row.dataPlantio);

        resolve(parsed);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Falha ao ler o Excel.'));
      }
    };
    reader.onerror = () => reject(new Error('Falha ao carregar o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

function summarizeFields(rows: PlantingRow[]): FieldSummary[] {
  const byField = new Map<string, PlantingRow[]>();
  rows.forEach((row) => {
    const key = [row.divisao, row.fazenda, row.talhao, row.variedade].join('||');
    const list = byField.get(key) ?? [];
    list.push(row);
    byField.set(key, list);
  });

  return Array.from(byField.entries()).map(([key, values]) => {
    const ordered = [...values].sort((a, b) => a.dataPlantio.getTime() - b.dataPlantio.getTime());
    const totalArea = ordered[0].areaTotal;
    const thresholdArea = totalArea * 0.7;
    let cumulative = 0;
    let plantingDate = ordered[0].dataPlantio;

    for (const item of ordered) {
      cumulative += item.areaPlantada;
      if (cumulative >= thresholdArea) {
        plantingDate = item.dataPlantio;
        break;
      }
    }

    return {
      id: key,
      divisao: ordered[0].divisao,
      fazenda: ordered[0].fazenda,
      talhao: ordered[0].talhao,
      variedade: ordered[0].variedade,
      areaTotal: totalArea,
      thresholdArea,
      plantingDate,
    };
  });
}

function buildAlertPeriods(points: DemandPoint[]): AlertPeriod[] {
  if (points.length === 0) return [];
  const periods: AlertPeriod[] = [];
  let current: AlertPeriod | null = null;

  points.forEach((point) => {
    const status: AlertPeriod['status'] = point.backlog > 0 ? 'NAO_ATENDE' : 'ATENDE';
    if (!current || current.status !== status) {
      if (current) periods.push(current);
      current = {
        status,
        start: point.date,
        end: point.date,
        maxBacklog: point.backlog,
        impactedArea: point.cumulativeDemand,
      };
      return;
    }
    current.end = point.date;
    current.maxBacklog = Math.max(current.maxBacklog, point.backlog);
    current.impactedArea = Math.max(current.impactedArea, point.cumulativeDemand);
  });

  if (current) periods.push(current);
  return periods;
}

function App() {
  const [rawRows, setRawRows] = useState<PlantingRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [operationType, setOperationType] = useState<OperationType>('ADUBACAO');
  const [groupBy, setGroupBy] = useState<GroupBy>('FAZENDA');
  const [varietyConfig, setVarietyConfig] = useState<Record<string, VarietyConfig>>({});
  const [operations, setOperations] = useState<OperationItem[]>([
    { id: crypto.randomUUID(), product: 'Primeira operação', dae: 5 },
  ]);
  const [machines, setMachines] = useState<MachineItem[]>([
    { id: crypto.randomUUID(), model: '4030M', quantity: 1, haPerDay: 150 },
  ]);

  const fieldSummaries = useMemo(() => summarizeFields(rawRows), [rawRows]);
  const varieties = useMemo(() => Array.from(new Set(fieldSummaries.map((item) => item.variedade))).sort(), [fieldSummaries]);

  const fieldsWithDates = useMemo(() => {
    return fieldSummaries
      .map((field) => {
        const config = varietyConfig[field.variedade];
        if (!config || !config.germinationDays || !config.cycleDays) return null;
        const emergenceDate = addDays(field.plantingDate, config.germinationDays);
        const harvestDate = addDays(emergenceDate, config.cycleDays);
        return {
          ...field,
          emergenceDate,
          harvestDate,
        };
      })
      .filter(Boolean) as Array<FieldSummary & { emergenceDate: Date; harvestDate: Date }>;
  }, [fieldSummaries, varietyConfig]);

  const totalDailyCapacity = useMemo(
    () => machines.reduce((sum, item) => sum + item.quantity * item.haPerDay, 0),
    [machines]
  );

  const scenarios = useMemo<ScenarioResult[]>(() => {
    if (!fieldsWithDates.length || totalDailyCapacity <= 0) return [];

    const scheduleMap = new Map<string, Map<string, number>>();

    const pushDemand = (groupName: string, date: Date, area: number) => {
      const key = toIsoDate(date);
      const groupSeries = scheduleMap.get(groupName) ?? new Map<string, number>();
      groupSeries.set(key, (groupSeries.get(key) ?? 0) + area);
      scheduleMap.set(groupName, groupSeries);
    };

    fieldsWithDates.forEach((field) => {
      const groupName =
        groupBy === 'DIVISAO' ? field.divisao :
        groupBy === 'FAZENDA' ? field.fazenda :
        groupBy === 'VARIEDADE' ? field.variedade :
        'GERAL';

      if (operationType === 'COLHEITA') {
        pushDemand(groupName, field.harvestDate, field.areaTotal);
      } else {
        operations.forEach((operation) => {
          if (!operation.product.trim()) return;
          pushDemand(groupName, addDays(field.emergenceDate, operation.dae), field.areaTotal);
        });
      }
    });

    return Array.from(scheduleMap.entries())
      .map(([groupName, series]) => {
        const dates = Array.from(series.keys()).sort();
        if (!dates.length) return null;
        const start = new Date(dates[0] + 'T00:00:00');
        const end = new Date(dates[dates.length - 1] + 'T00:00:00');
        const demandByDate = new Map(series);
        const points: DemandPoint[] = [];
        let current = new Date(start);
        let cumulativeDemand = 0;
        let capacity = 0;

        while (current.getTime() <= end.getTime()) {
          const iso = toIsoDate(current);
          const demand = demandByDate.get(iso) ?? 0;
          cumulativeDemand += demand;
          capacity = Math.min(cumulativeDemand, capacity + totalDailyCapacity);
          const backlog = Math.max(0, cumulativeDemand - capacity);
          points.push({
            date: iso,
            demand,
            cumulativeDemand,
            capacity,
            backlog,
            machinesNeeded: totalDailyCapacity > 0 ? Math.ceil(backlog / totalDailyCapacity) : 0,
          });
          current = addDays(current, 1);
        }

        const totalArea = points[points.length - 1]?.cumulativeDemand ?? 0;
        return {
          groupName,
          totalArea,
          maxBacklog: Math.max(...points.map((p) => p.backlog), 0),
          firstDemandDate: points[0]?.date,
          lastDemandDate: points[points.length - 1]?.date,
          dailyCapacity: totalDailyCapacity,
          points,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.maxBacklog ?? 0) - (a?.maxBacklog ?? 0)) as ScenarioResult[];
  }, [fieldsWithDates, totalDailyCapacity, groupBy, operationType, operations]);

  const periodsByScenario = useMemo(() => {
    return Object.fromEntries(scenarios.map((scenario) => [scenario.groupName, buildAlertPeriods(scenario.points)]));
  }, [scenarios]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const parsed = await readWorkbook(file);
      setRawRows(parsed);
      setFileName(file.name);
      const uniqueVarieties = Array.from(new Set(parsed.map((row) => row.variedade))).sort();
      setVarietyConfig((current) => {
        const next = { ...current };
        uniqueVarieties.forEach((name) => {
          next[name] = next[name] ?? { germinationDays: 5, cycleDays: 180 };
        });
        return next;
      });
    } catch (err) {
      setRawRows([]);
      setError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.');
    } finally {
      setLoading(false);
    }
  };

  const updateVariety = (variety: string, field: keyof VarietyConfig, value: number) => {
    setVarietyConfig((current) => ({
      ...current,
      [variety]: {
        ...current[variety],
        [field]: value,
      },
    }));
  };

  const updateOperation = (id: string, field: keyof OperationItem, value: string | number) => {
    setOperations((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const updateMachine = (id: string, field: keyof MachineItem, value: string | number) => {
    setMachines((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const canAdvanceToOperations = rawRows.length > 0 && varieties.every((name) => {
    const config = varietyConfig[name];
    return Boolean(config?.germinationDays && config?.cycleDays);
  });

  return (
    <div className="page-shell">
      <header className="hero-card">
        <div>
          <div className="eyebrow">Planejamento operacional agrícola</div>
          <h1>Agro Cronograma Web</h1>
          <p>
            Faça upload da planilha de plantio, calcule automaticamente a data de plantio pelo critério de 70% da área total,
            projete germinação e ciclo e simule a capacidade do parque de máquinas para adubação, pulverização e colheita.
          </p>
        </div>
        <div className="hero-highlight">
          <strong>Colunas esperadas</strong>
          <span>{REQUIRED_COLUMNS.join(' • ')}</span>
        </div>
      </header>

      <section className="card">
        <div className="section-title">
          <h2>1. Upload do Excel</h2>
          <span>{fileName ? `Arquivo carregado: ${fileName}` : 'Envie a base de plantio'}</span>
        </div>
        <label className="upload-box">
          <input type="file" accept=".xlsx,.xls" onChange={handleUpload} />
          <span>{loading ? 'Lendo arquivo...' : 'Clique para selecionar o Excel'}</span>
          <small>O sistema usa a primeira aba da planilha.</small>
        </label>
        {error ? <div className="error-box">{error}</div> : null}
        {rawRows.length > 0 ? (
          <div className="stats-grid">
            <div className="stat-card"><strong>{rawRows.length}</strong><span>linhas importadas</span></div>
            <div className="stat-card"><strong>{fieldSummaries.length}</strong><span>talhões consolidados</span></div>
            <div className="stat-card"><strong>{varieties.length}</strong><span>variedades encontradas</span></div>
            <div className="stat-card"><strong>{formatNumber(fieldSummaries.reduce((s, i) => s + i.areaTotal, 0))}</strong><span>ha totais</span></div>
          </div>
        ) : null}
      </section>

      {rawRows.length > 0 ? (
        <section className="card">
          <div className="section-title">
            <h2>2. Germinação e ciclo por variedade</h2>
            <span>Preencha os parâmetros para gerar as datas operacionais.</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variedade / Híbrido</th>
                  <th>Dias para Germinação</th>
                  <th>Ciclo total (dias)</th>
                </tr>
              </thead>
              <tbody>
                {varieties.map((variety) => (
                  <tr key={variety}>
                    <td>{variety}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={varietyConfig[variety]?.germinationDays ?? 0}
                        onChange={(e) => updateVariety(variety, 'germinationDays', Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={varietyConfig[variety]?.cycleDays ?? 0}
                        onChange={(e) => updateVariety(variety, 'cycleDays', Number(e.target.value))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canAdvanceToOperations ? (
        <section className="card">
          <div className="section-title">
            <h2>3. Operações</h2>
            <span>Defina a operação que deseja simular.</span>
          </div>
          <div className="inline-grid">
            <div>
              <label>Tipo de operação</label>
              <select value={operationType} onChange={(e) => setOperationType(e.target.value as OperationType)}>
                <option value="ADUBACAO">Adubação</option>
                <option value="PULVERIZACAO">Pulverização</option>
                <option value="COLHEITA">Colheita</option>
              </select>
            </div>
            <div>
              <label>Agrupar gráficos por</label>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="DIVISAO">Divisão</option>
                <option value="FAZENDA">Fazenda</option>
                <option value="VARIEDADE">Variedade</option>
                <option value="GERAL">Geral</option>
              </select>
            </div>
          </div>

          {operationType !== 'COLHEITA' ? (
            <>
              <div className="list-header">
                <h3>Momentos de aplicação</h3>
                <button
                  className="secondary-btn"
                  onClick={() => setOperations((current) => [...current, { id: crypto.randomUUID(), product: '', dae: 0 }])}
                >
                  + Adicionar operação
                </button>
              </div>
              <div className="stack-list">
                {operations.map((operation, index) => (
                  <div className="operation-card" key={operation.id}>
                    <div className="operation-index">{index + 1}</div>
                    <div>
                      <label>Produto / nome da operação</label>
                      <input
                        type="text"
                        value={operation.product}
                        onChange={(e) => updateOperation(operation.id, 'product', e.target.value)}
                        placeholder="Ex.: Primeira de Sulfato de Amônia"
                      />
                    </div>
                    <div>
                      <label>DAE (dias após emergência)</label>
                      <input
                        type="number"
                        min={0}
                        value={operation.dae}
                        onChange={(e) => updateOperation(operation.id, 'dae', Number(e.target.value))}
                      />
                    </div>
                    <button className="danger-btn" onClick={() => setOperations((current) => current.filter((item) => item.id !== operation.id))}>
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="info-box">
              Para colheita, a data da demanda é calculada automaticamente como <strong>Emergência + Ciclo total</strong>.
            </div>
          )}
        </section>
      ) : null}

      {canAdvanceToOperations ? (
        <section className="card">
          <div className="section-title">
            <h2>4. Dimensionamento de máquinas</h2>
            <span>Informe modelos, quantidade e rendimento operacional em ha/dia.</span>
          </div>
          <div className="list-header">
            <h3>Parque de máquinas</h3>
            <button
              className="secondary-btn"
              onClick={() => setMachines((current) => [...current, { id: crypto.randomUUID(), model: '', quantity: 1, haPerDay: 100 }])}
            >
              + Adicionar modelo
            </button>
          </div>
          <div className="stack-list">
            {machines.map((machine) => (
              <div className="machine-card" key={machine.id}>
                <div>
                  <label>Modelo</label>
                  <input
                    type="text"
                    value={machine.model}
                    onChange={(e) => updateMachine(machine.id, 'model', e.target.value)}
                    placeholder="Ex.: 4030M"
                  />
                </div>
                <div>
                  <label>Número de máquinas</label>
                  <input
                    type="number"
                    min={0}
                    value={machine.quantity}
                    onChange={(e) => updateMachine(machine.id, 'quantity', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>Rendimento (ha/dia)</label>
                  <input
                    type="number"
                    min={0}
                    value={machine.haPerDay}
                    onChange={(e) => updateMachine(machine.id, 'haPerDay', Number(e.target.value))}
                  />
                </div>
                <button className="danger-btn" onClick={() => setMachines((current) => current.filter((item) => item.id !== machine.id))}>
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="stats-grid compact">
            <div className="stat-card"><strong>{formatNumber(totalDailyCapacity)}</strong><span>ha/dia total</span></div>
            <div className="stat-card"><strong>{machines.reduce((s, i) => s + i.quantity, 0)}</strong><span>máquinas totais</span></div>
            <div className="stat-card"><strong>{OPERATION_LABEL[operationType]}</strong><span>operação simulada</span></div>
          </div>
        </section>
      ) : null}

      {scenarios.length > 0 ? (
        <section className="card">
          <div className="section-title">
            <h2>5. Resultado do cronograma</h2>
            <span>Capacidade acumulada x programação acumulada.</span>
          </div>
          <div className="info-box">
            Regra da capacidade: a máquina trabalha somente perante a demanda. Assim, a linha de capacidade sobe até alcançar a demanda acumulada e fica estável até surgir nova necessidade.
          </div>
          {scenarios.map((scenario) => (
            <div className="scenario-block" key={scenario.groupName}>
              <div className="scenario-header">
                <div>
                  <h3>Programada x Capacidade — {scenario.groupName}</h3>
                  <p>
                    Área demandada: <strong>{formatNumber(scenario.totalArea)} ha</strong> • Capacidade diária: <strong>{formatNumber(scenario.dailyCapacity)} ha/dia</strong>
                  </p>
                </div>
                <div className={`badge ${scenario.maxBacklog > 0 ? 'badge-warn' : 'badge-ok'}`}>
                  {scenario.maxBacklog > 0 ? `Gargalo máximo: ${formatNumber(scenario.maxBacklog)} ha` : 'Capacidade atende a demanda'}
                </div>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={scenario.points} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} minTickGap={24} />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number, name) => [formatNumber(Number(value)), name === 'cumulativeDemand' ? 'Programação Total' : 'Capacidade']}
                      labelFormatter={(label) => `Data: ${formatDate(String(label))}`}
                    />
                    <Legend formatter={(value) => (value === 'cumulativeDemand' ? 'PROGRAMAÇÃO TOTAL' : 'CAPACIDADE')} />
                    <Line type="stepAfter" dataKey="cumulativeDemand" strokeWidth={3} dot={false} name="cumulativeDemand" stroke="#0b5f84" />
                    <Line type="stepAfter" dataKey="capacity" strokeWidth={3} dot={false} name="capacity" stroke="#df6b2d" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Início</th>
                      <th>Fim</th>
                      <th>Maior déficit (ha)</th>
                      <th>Área acumulada no período (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodsByScenario[scenario.groupName]?.map((period, idx) => (
                      <tr key={`${scenario.groupName}-${idx}`}>
                        <td>
                          <span className={`pill ${period.status === 'NAO_ATENDE' ? 'pill-warn' : 'pill-ok'}`}>
                            {period.status === 'NAO_ATENDE' ? 'Não atende' : 'Atende'}
                          </span>
                        </td>
                        <td>{formatDate(period.start)}</td>
                        <td>{formatDate(period.end)}</td>
                        <td>{formatNumber(period.maxBacklog)}</td>
                        <td>{formatNumber(period.impactedArea)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card muted-card">
        <div className="section-title">
          <h2>Lógica usada no sistema</h2>
          <span>Resumo da regra de negócio implementada.</span>
        </div>
        <ul className="clean-list">
          <li>A data de plantio do talhão é definida no primeiro dia em que o acumulado de <strong>Área Plantada(ha)</strong> atinge ou ultrapassa <strong>70% da Área Total(ha)</strong>.</li>
          <li>A data de emergência é calculada como <strong>Data de Plantio + Dias para Germinação</strong>.</li>
          <li>Para colheita, a demanda acontece em <strong>Emergência + Ciclo total</strong>.</li>
          <li>Para adubação e pulverização, cada operação usa <strong>Emergência + DAE</strong>.</li>
          <li>A capacidade acumulada sobe diariamente conforme o parque de máquinas, mas nunca ultrapassa a demanda acumulada.</li>
        </ul>
      </section>
    </div>
  );
}

export default App;
