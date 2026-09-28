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
    domain: string;
    subDomain: string;
  };
  init(config: Record<string, unknown>): void;
  destroy(): void;
  getSubDomain(date: Date): Date[];
  positionSubDomainX(t: number, index?: number): number;
  getSubDomainColumnNumber(d: number): number;
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

const CELL_SIZE = 10;
const CELL_PADDING = 2;

interface RenderedCell {
  t: number;
  v: number | null;
  x: number;
  text: string | null;
  fill: string | null;
}

interface RenderedMonth {
  month: number;
  width: number;
  cells: RenderedCell[];
}

beforeAll(() => {
  // jsdom does not implement SVG geometry; d3-tip only needs a point object.
  const proto = SVGSVGElement.prototype as unknown as {
    createSVGPoint?: () => { x: number; y: number };
  };
  proto.createSVGPoint ??= () => ({ x: 0, y: 0 });
});

async function renderMonthWeekCalendar(
  start: Date,
  range: number,
  data: Record<number, number>,
): Promise<RenderedMonth[]> {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const calendar = new CalHeatMap();
  calendar.init({
    itemSelector: element,
    start,
    range,
    domain: 'month',
    subDomain: 'week',
    data,
    cellSize: CELL_SIZE,
    cellPadding: CELL_PADDING,
    animationDuration: 0,
    tooltip: true,
    displayLegend: false,
    legend: [1, 10, 20, 30],
    legendColors: { min: '#ffffff', max: '#000000', empty: '#eeeeee' },
    subDomainTextFormat: (_date: Date, value: number | null) =>
      value === null ? '' : String(value),
  });
  // Values, colors and value labels are applied through d3 transitions.
  await new Promise(resolve => setTimeout(resolve, 100));
  const months = Array.from(
    element.querySelectorAll<SVGSVGElement>('svg.graph-domain'),
  ).map(domain => {
    const subDomain = domain.querySelector('svg') as SVGSVGElement;
    const cells = Array.from(subDomain.querySelectorAll('g')).map(group => {
      const rect = group.querySelector('rect') as SVGRectElement;
      const datum = (rect as unknown as { __data__: { t: number; v: number } })
        .__data__;
      return {
        t: datum.t,
        v: datum.v,
        x: Number(rect.getAttribute('x')),
        text: group.querySelector('text')?.textContent ?? null,
        fill: rect.getAttribute('fill'),
      };
    });
    return {
      month: (domain as unknown as { __data__: number }).__data__,
      width: Number(
        domain.querySelector('rect.domain-background')?.getAttribute('width'),
      ),
      cells,
    };
  });
  calendar.destroy();
  element.remove();
  return months;
}

function mondaysOfMonthBlock(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const cursor = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, month + 1, 0);
  const mondays: Date[] = [];
  while (cursor <= last) {
    mondays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return mondays;
}

function expectWellFormedMonthBlock(rendered: RenderedMonth) {
  const month = new Date(rendered.month);
  const expectedWeeks = mondaysOfMonthBlock(
    month.getFullYear(),
    month.getMonth(),
  ).map(d => d.getTime());
  const xs = rendered.cells.map(cell => cell.x);

  expect(rendered.cells.map(cell => cell.t)).toEqual(expectedWeeks);
  expect(xs).toEqual(
    expectedWeeks.map((_, i) => i * (CELL_SIZE + CELL_PADDING)),
  );
  expect(Math.max(...xs) + CELL_SIZE).toBeLessThanOrEqual(rendered.width);
}

test('Month/Week layout renders May and June 2026 weeks without overlap', async () => {
  const may4 = new Date(2026, 4, 4).getTime();
  const may25 = new Date(2026, 4, 25).getTime();
  const june1 = new Date(2026, 5, 1).getTime();
  const [may, june] = await renderMonthWeekCalendar(new Date(2026, 4, 1), 2, {
    [may4 / 1000]: 4,
    [may25 / 1000]: 25,
    [june1 / 1000]: 1,
  });

  // May 2026 starts on a Friday, so its block begins with 2026-04-27.
  expectWellFormedMonthBlock(may);
  expect(may.cells[0].t).toBe(new Date(2026, 3, 27).getTime());
  // June 2026 starts on Monday, the week start day.
  expectWellFormedMonthBlock(june);
  expect(june.cells[0].t).toBe(june1);

  const cellAt = (block: RenderedMonth, t: number) =>
    block.cells.find(cell => cell.t === t);
  expect(cellAt(may, may4)).toMatchObject({ v: 4, text: '4' });
  expect(cellAt(may, may25)).toMatchObject({ v: 25, text: '25' });
  expect(cellAt(june, june1)).toMatchObject({ v: 1, text: '1' });
  expect(cellAt(may, may4)?.fill).not.toBe(cellAt(may, may25)?.fill);
  expect(cellAt(may, new Date(2026, 4, 11).getTime())).toMatchObject({
    v: null,
    text: '',
  });
});

test('Month/Week layout keeps cells inside blocks across a year transition and different month lengths', async () => {
  // Nov 2026 .. Mar 2027: Dec -> Jan crosses a year and shares the week
  // of 2026-12-28, Feb 2027 is exactly four weeks starting on a Monday.
  const rendered = await renderMonthWeekCalendar(new Date(2026, 10, 1), 5, {});

  expect(rendered.map(block => new Date(block.month).getMonth())).toEqual([
    10, 11, 0, 1, 2,
  ]);
  rendered.forEach(expectWellFormedMonthBlock);
  expect(rendered[2].cells[0].t).toBe(new Date(2026, 11, 28).getTime());
  expect(rendered[3].cells).toHaveLength(4);
});

test('Month/Week positions are distinct, ordered and fit their block for every month of 2026', () => {
  const calendar = new CalHeatMap();
  calendar.options.domain = 'month';
  calendar.options.subDomain = 'week';

  for (let month = 0; month < 12; month += 1) {
    const monthStart = new Date(2026, month, 1);
    const weeks = calendar.getSubDomain(monthStart);
    const xs = weeks.map((week, i) =>
      calendar.positionSubDomainX(week.getTime(), i),
    );
    const columns = calendar.getSubDomainColumnNumber(monthStart.getTime());

    expect(weeks.map(w => w.getTime())).toEqual(
      mondaysOfMonthBlock(2026, month).map(d => d.getTime()),
    );
    expect(xs).toEqual(weeks.map((_, i) => i * (CELL_SIZE + CELL_PADDING)));
    expect(columns).toBe(weeks.length);
  }
});
