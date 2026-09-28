/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import CalHeatMapImport from '../src/vendor/cal-heatmap';

type DateFormatter = (date: Date, format: string) => string;
type FunctionalDateFormat = (date: Date) => string;

interface CalHeatMapInstance {
  options: {
    dateFormatter: DateFormatter | null;
    timeFormatter: (t: number) => string;
    valueFormatter: (v: number) => string;
  };
  formatDate(date: Date, format: string | FunctionalDateFormat): string;
  tip: { html(): (d: { t: number; v: number }) => string };
  legendTip: { html(): (d: number) => string };
}

const CalHeatMap = CalHeatMapImport as unknown as new () => CalHeatMapInstance;

test('CalHeatMap delegates string date formats to the configured formatter', () => {
  const calendar = new CalHeatMap();
  const date = new Date(2024, 0, 1);
  const dateFormatter = jest.fn<string, [Date, string]>(() => 'Январь');
  calendar.options.dateFormatter = dateFormatter;

  expect(calendar.formatDate(date, '%B')).toBe('Январь');
  expect(dateFormatter).toHaveBeenCalledWith(date, '%B');
});

test('CalHeatMap preserves functional formatters over the configured formatter', () => {
  const calendar = new CalHeatMap();
  const date = new Date(2024, 0, 1);
  const dateFormatter = jest.fn<string, [Date, string]>(() => 'localized');
  const functionalFormat = jest.fn<string, [Date]>(() => 'custom');
  calendar.options.dateFormatter = dateFormatter;

  expect(calendar.formatDate(date, functionalFormat)).toBe('custom');
  expect(functionalFormat).toHaveBeenCalledWith(date);
  expect(dateFormatter).not.toHaveBeenCalled();
});

test('CalHeatMap keeps the D3 formatter fallback', () => {
  const calendar = new CalHeatMap();
  const date = new Date(2024, 0, 1);

  expect(calendar.formatDate(date, '%B')).toBe('January');
});

test('cell tooltip HTML escapes creator-controlled formatter output', () => {
  // Regression test: the tip's .html() callback is assigned to the
  // tooltip node via innerHTML (d3-tip), so formatter output must be
  // escaped before it's returned.
  const calendar = new CalHeatMap();
  calendar.options.timeFormatter = () => '<img src=x onerror=alert(1)>';
  calendar.options.valueFormatter = () => '<svg onload=alert(2)>';

  const html = calendar.tip.html()({ t: 0, v: 1 });

  expect(html).not.toContain('<img');
  expect(html).not.toContain('<svg');
  expect(html).toContain('&lt;img');
  expect(html).toContain('&lt;svg');
});

test('legend tooltip HTML escapes creator-controlled formatter output', () => {
  const calendar = new CalHeatMap();
  calendar.options.valueFormatter = () => '<img src=x onerror=alert(1)>';

  const html = calendar.legendTip.html()(1);

  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
});

interface RenderedCell {
  date: Date;
  value: number | null;
  x: number;
  textX: number;
  title: string;
}

interface RenderedMonth {
  width: number;
  cells: RenderedCell[];
}

const CELL_SIZE = 10;
const CELL_PADDING = 2;
const DOMAIN_GUTTER = 2;
const CELL_STEP = CELL_SIZE + CELL_PADDING;

interface RenderableCalHeatMap {
  init(config: Record<string, unknown>): void;
  next(): void;
}

const LEGEND = [10, 30, 50, 70, 90, 110, 130, 150, 170, 190];

const svgPointDescriptor = Object.getOwnPropertyDescriptor(
  window.SVGSVGElement.prototype,
  'createSVGPoint',
);

beforeEach(() => {
  Object.defineProperty(window.SVGSVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    value: () => ({ matrixTransform: () => ({ x: 0, y: 0 }) }),
  });
});

afterEach(() => {
  if (svgPointDescriptor) {
    Object.defineProperty(
      window.SVGSVGElement.prototype,
      'createSVGPoint',
      svgPointDescriptor,
    );
  } else {
    delete (
      window.SVGSVGElement.prototype as Partial<
        Pick<SVGSVGElement, 'createSVGPoint'>
      >
    ).createSVGPoint;
  }
  document.body.innerHTML = '';
});

function dailyData(from: Date, to: Date): Record<string, number> {
  const data: Record<string, number> = {};
  for (
    let day = new Date(from);
    day <= to;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  ) {
    data[String(day.getTime() / 1000)] = day.getDate();
  }
  return data;
}

function renderMonthWeekCalendar(
  config: Record<string, unknown>,
  navigate?: (calendar: RenderableCalHeatMap) => void,
): Map<string, RenderedMonth> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const calendar =
    new (CalHeatMapImport as unknown as new () => RenderableCalHeatMap)();
  calendar.init({
    itemSelector: container,
    domain: 'month',
    subDomain: 'week',
    cellSize: CELL_SIZE,
    cellPadding: CELL_PADDING,
    domainGutter: DOMAIN_GUTTER,
    animationDuration: 0,
    tooltip: false,
    subDomainTextFormat: '%d',
    legend: LEGEND,
    legendColors: { min: '#ffffff', max: '#000000', empty: '#eeeeee' },
    ...config,
  });
  navigate?.(calendar);

  const months = new Map<string, RenderedMonth>();
  container.querySelectorAll('svg.graph-domain').forEach(domain => {
    const [, month, year] =
      /m_(\d+) y_(\d+)/.exec(domain.getAttribute('class') ?? '') ?? [];
    const cells = Array.from(domain.querySelectorAll('g')).map(group => {
      const datum = (group as unknown as { __data__: { t: number; v: number } })
        .__data__;
      return {
        date: new Date(datum.t),
        value: datum.v,
        x: Number(group.querySelector('rect')?.getAttribute('x')),
        textX: Number(group.querySelector('text')?.getAttribute('x')),
        title: group.querySelector('title')?.textContent ?? '',
      };
    });
    months.set(`${year}-${month}`, {
      width: Number(domain.getAttribute('width')),
      cells,
    });
  });
  return months;
}

function expectWeeksLaidOutInBlock(
  month: RenderedMonth | undefined,
  firstWeekStart: Date,
  weekCount: number,
) {
  expect(month).toBeDefined();
  const { cells, width } = month!;
  expect(cells.map(cell => cell.date)).toEqual(
    Array.from(
      { length: weekCount },
      (_, i) =>
        new Date(
          firstWeekStart.getFullYear(),
          firstWeekStart.getMonth(),
          firstWeekStart.getDate() + 7 * i,
        ),
    ),
  );
  expect(cells.map(cell => cell.x)).toEqual(cells.map((_, i) => i * CELL_STEP));
  expect(cells.map(cell => cell.textX)).toEqual(
    cells.map(cell => cell.x + CELL_SIZE / 2),
  );
  expect(width).toBe(weekCount * CELL_STEP + DOMAIN_GUTTER);
}

test('Month/Week renders May and June 2026 weeks side by side within each block', () => {
  const months = renderMonthWeekCalendar({
    start: new Date(2026, 4, 1),
    range: 2,
    data: dailyData(new Date(2026, 3, 27), new Date(2026, 6, 5)),
  });

  const may = months.get('2026-5');
  const june = months.get('2026-6');
  // May 1st is a Friday: the block starts with the week of 2026-04-27.
  expectWeeksLaidOutInBlock(may, new Date(2026, 3, 27), 5);
  // June 1st is a Monday: the first cell is June's own first week.
  expectWeeksLaidOutInBlock(june, new Date(2026, 5, 1), 5);

  // Values and titles stay attached to the week they belong to.
  // May's block only aggregates May's own days, including May 1-3 in the
  // week starting 2026-04-27.
  expect(may!.cells.map(cell => cell.value)).toEqual([
    1 + 2 + 3,
    4 + 5 + 6 + 7 + 8 + 9 + 10,
    11 + 12 + 13 + 14 + 15 + 16 + 17,
    18 + 19 + 20 + 21 + 22 + 23 + 24,
    25 + 26 + 27 + 28 + 29 + 30 + 31,
  ]);
  expect(june!.cells[0].value).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7);
  expect(june!.cells.map(cell => cell.title)).toEqual([
    'June Week #22',
    'June Week #23',
    'June Week #24',
    'June Week #25',
    'June Week #26',
  ]);
});

test('Month/Week lays out blocks across a year transition', () => {
  const months = renderMonthWeekCalendar({
    start: new Date(2026, 11, 1),
    range: 2,
    data: dailyData(new Date(2026, 10, 30), new Date(2027, 0, 31)),
  });

  expectWeeksLaidOutInBlock(months.get('2026-12'), new Date(2026, 10, 30), 5);
  expectWeeksLaidOutInBlock(months.get('2027-1'), new Date(2026, 11, 28), 5);
});

test('Month/Week sizes blocks for months spanning four to six weeks', () => {
  const months = renderMonthWeekCalendar({
    start: new Date(2027, 1, 1),
    range: 2,
    data: {},
  });
  // February 2027 starts on Monday and has exactly four weeks.
  expectWeeksLaidOutInBlock(months.get('2027-2'), new Date(2027, 1, 1), 4);

  const march = renderMonthWeekCalendar({
    start: new Date(2026, 2, 1),
    range: 1,
    data: {},
  });
  // March 2026 starts on Sunday and touches six weeks.
  expectWeeksLaidOutInBlock(march.get('2026-3'), new Date(2026, 1, 23), 6);
});

test('Month/Week keeps the layout for blocks loaded while browsing', () => {
  const months = renderMonthWeekCalendar(
    { start: new Date(2026, 4, 1), range: 1, data: {} },
    calendar => calendar.next(),
  );

  expectWeeksLaidOutInBlock(months.get('2026-6'), new Date(2026, 5, 1), 5);
});

test('Month/Week lays out Sunday-start weeks within each block', () => {
  const months = renderMonthWeekCalendar({
    start: new Date(2026, 10, 1),
    range: 1,
    weekStartOnMonday: false,
    data: {},
  });

  // November 2026 starts on Sunday, the configured week start.
  expectWeeksLaidOutInBlock(months.get('2026-11'), new Date(2026, 10, 1), 5);
});
