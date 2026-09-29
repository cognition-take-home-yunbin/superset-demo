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

interface RenderedWeekCell {
  t: number;
  v: number | null;
  x: number;
}

interface RenderedMonthBlock {
  width: number;
  cells: RenderedWeekCell[];
}

type LayoutCalHeatMap = new () => {
  init(config: Record<string, unknown>): void;
  destroy(): null;
};

const createSVGPointDescriptor = Object.getOwnPropertyDescriptor(
  window.SVGSVGElement.prototype,
  'createSVGPoint',
);

beforeAll(() => {
  // d3-tip needs createSVGPoint, which jsdom does not implement.
  Object.defineProperty(window.SVGSVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    value: () => ({
      matrixTransform: () => ({ x: 0, y: 0 }),
    }),
  });
});

afterAll(() => {
  if (createSVGPointDescriptor) {
    Object.defineProperty(
      window.SVGSVGElement.prototype,
      'createSVGPoint',
      createSVGPointDescriptor,
    );
  } else {
    delete (
      window.SVGSVGElement.prototype as Partial<
        Pick<SVGSVGElement, 'createSVGPoint'>
      >
    ).createSVGPoint;
  }
});

const LAYOUT_CELL_SIZE = 10;
const LAYOUT_CELL_PADDING = 2;
const LAYOUT_STEP = LAYOUT_CELL_SIZE + LAYOUT_CELL_PADDING;

function renderMonthWeekCalendar(
  start: Date,
  range: number,
  data: Record<string, number> = {},
  weekStartOnMonday = true,
): RenderedMonthBlock[] {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const calendar = new (CalHeatMapImport as unknown as LayoutCalHeatMap)();
  calendar.init({
    itemSelector: container,
    domain: 'month',
    subDomain: 'week',
    start,
    range,
    data,
    weekStartOnMonday,
    cellSize: LAYOUT_CELL_SIZE,
    cellPadding: LAYOUT_CELL_PADDING,
    domainGutter: 0,
    animationDuration: 0,
    displayLegend: false,
    tooltip: false,
  });

  const blocks = Array.from(
    container.querySelectorAll<SVGSVGElement>('svg.graph-domain'),
  ).map(domain => ({
    width: Number(domain.getAttribute('width')),
    cells: Array.from(
      domain.querySelectorAll<SVGRectElement>(
        '.graph-subdomain-group rect.graph-rect',
      ),
    ).map(rect => {
      const datum = (rect as unknown as { __data__: { t: number; v: number } })
        .__data__;
      return { t: datum.t, v: datum.v, x: Number(rect.getAttribute('x')) };
    }),
  }));
  calendar.destroy();
  container.remove();
  return blocks;
}

function expectedWeekStarts(
  year: number,
  month: number,
  weekStartOnMonday = true,
): number[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + (weekStartOnMonday ? 6 : 0)) % 7;
  const lastDay = new Date(year, month + 1, 0);
  const weeks: number[] = [];
  for (
    let week = new Date(year, month, 1 - offset);
    week <= lastDay;
    week = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7)
  ) {
    weeks.push(week.getTime());
  }
  return weeks;
}

function expectContainedSequentialLayout(
  blocks: RenderedMonthBlock[],
  startYear: number,
  startMonth: number,
  weekStartOnMonday = true,
) {
  blocks.forEach((block, index) => {
    const monthStart = new Date(startYear, startMonth + index, 1);
    const weeks = expectedWeekStarts(
      monthStart.getFullYear(),
      monthStart.getMonth(),
      weekStartOnMonday,
    );
    expect(block.cells.map(cell => cell.t)).toEqual(weeks);
    expect(block.cells.map(cell => cell.x)).toEqual(
      weeks.map((_, i) => i * LAYOUT_STEP),
    );
    expect(block.width).toBeGreaterThanOrEqual(weeks.length * LAYOUT_STEP);
  });
}

const toSeconds = (date: Date) => String(date.getTime() / 1000);

test('Month/Week layout places May and June 2026 week cells without overlap or negative offsets', () => {
  const blocks = renderMonthWeekCalendar(new Date(2026, 4, 1), 2, {
    [toSeconds(new Date(2026, 4, 1))]: 5,
    [toSeconds(new Date(2026, 4, 25))]: 7,
    [toSeconds(new Date(2026, 5, 1))]: 9,
  });

  expect(blocks).toHaveLength(2);
  expectContainedSequentialLayout(blocks, 2026, 4);

  const [may, june] = blocks;
  expect(may.cells[0]).toEqual({
    t: new Date(2026, 3, 27).getTime(),
    v: 5,
    x: 0,
  });
  expect(may.cells[4]).toEqual({
    t: new Date(2026, 4, 25).getTime(),
    v: 7,
    x: 4 * LAYOUT_STEP,
  });
  expect(june.cells[0]).toEqual({
    t: new Date(2026, 5, 1).getTime(),
    v: 9,
    x: 0,
  });
});

test.each([
  ['December 2025 to December 2026 (year transition)', 2025, 11, 13],
  ['February 2021 (four whole weeks, starts on Monday)', 2021, 1, 1],
  ['February and March 2024 (leap year)', 2024, 1, 2],
  ['March 2026 (six week cells)', 2026, 2, 1],
])(
  'Month/Week layout keeps week cells sequential and inside their month: %s',
  (_label, year, month, range) => {
    const blocks = renderMonthWeekCalendar(new Date(year, month, 1), range);

    expect(blocks).toHaveLength(range);
    expectContainedSequentialLayout(blocks, year, month);
  },
);

test('Month/Week layout keeps week cells sequential when weeks start on Sunday', () => {
  const blocks = renderMonthWeekCalendar(new Date(2026, 1, 1), 4, {}, false);

  expect(blocks).toHaveLength(4);
  expectContainedSequentialLayout(blocks, 2026, 1, false);
});
