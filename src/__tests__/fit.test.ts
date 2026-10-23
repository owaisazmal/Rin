import { plannerFit, usesSideRail } from '../fit';

const none = { left: 0, right: 0 };

describe('plannerFit', () => {
  it('keeps phones in one column with the chart they had', () => {
    expect(plannerFit({ width: 375, height: 667 }, none)).toEqual({ split: false, column: 343, chart: 311 });
    expect(plannerFit({ width: 402, height: 874 }, none)).toEqual({ split: false, column: 370, chart: 338 });
    expect(plannerFit({ width: 440, height: 956 }, none)).toEqual({ split: false, column: 408, chart: 376 });
  });

  // sizes and insets as the iPhone Duo simulator reports them
  const duoSide = { left: 0, right: 84 };

  it('keeps the folded Duo in one column, with the whole tracker on screen', () => {
    expect(plannerFit({ width: 466, height: 678 }, duoSide)).toEqual({ split: false, column: 350, chart: 318 });
  });

  it('splits the unfolded Duo on its side', () => {
    expect(plannerFit({ width: 951, height: 669 }, duoSide)).toEqual({ split: true, column: 410, chart: 314 });
  });

  it('keeps the unfolded Duo upright, and half of it in Split View, in one column', () => {
    expect(plannerFit({ width: 669, height: 951 }, none)).toEqual({ split: false, column: 608, chart: 420 });
    expect(plannerFit({ width: 475, height: 669 }, none).split).toBe(false);
  });

  it('splits iPads except the mini held upright', () => {
    expect(plannerFit({ width: 744, height: 1133 }, none).split).toBe(false);
    expect(plannerFit({ width: 820, height: 1180 }, none).split).toBe(true);
    expect(plannerFit({ width: 1376, height: 1032 }, none)).toEqual({ split: true, column: 467, chart: 420 });
  });
});

describe('usesSideRail', () => {
  it('takes the Duo, whose status bar runs down the right edge', () => {
    expect(usesSideRail({ top: 0, left: 0, right: 84 })).toBe(true);
  });

  it('leaves phones, iPads and a landscape camera cutout alone', () => {
    expect(usesSideRail({ top: 62, left: 0, right: 0 })).toBe(false);
    expect(usesSideRail({ top: 24, left: 0, right: 0 })).toBe(false);
    expect(usesSideRail({ top: 0, left: 0, right: 48 })).toBe(false);
  });
});
