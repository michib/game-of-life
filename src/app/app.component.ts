import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EMPTY, interval, merge, Observable, Subject } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  pluck,
  scan,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
} from 'rxjs/operators';

interface Field {
  status: Array<boolean>;
  aliveCells: Set<number>;
  deadCellsWithAliveNeighbours: Set<number>;
  neighbours: Map<number, Array<number>>;
}

@Component({
  selector: 'gol-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  form: FormGroup = new FormGroup({});

  field$: Observable<Field> = EMPTY;

  setStatus$: Subject<{ index: number; status: boolean }> = new Subject();

  @ViewChild('field') fieldElement: ElementRef<HTMLElement> | null = null;

  tick$: Observable<number> = EMPTY;
  play$: Subject<boolean> = new Subject();

  private readonly unsubscribe$: Subject<void> = new Subject();

  constructor(private readonly formBuilder: FormBuilder) {}

  ngOnInit(): void {
    this.form = this.formBuilder.group({
      height: this.formBuilder.control(20, [
        Validators.required,
        Validators.min(10),
        Validators.max(200),
      ]),
      width: this.formBuilder.control(20, [
        Validators.required,
        Validators.min(10),
        Validators.max(200),
      ]),
      cellSize: this.formBuilder.control(20, [
        Validators.required,
        Validators.min(1),
        Validators.max(200),
      ]),
      interval: this.formBuilder.control(500, [
        Validators.required,
        Validators.min(15),
        Validators.max(2000),
      ]),
      cellAliveColor: this.formBuilder.control(500, [Validators.required]),
      cellDeadColor: this.formBuilder.control(500, [Validators.required]),
    });

    const settings$ = this.form.valueChanges.pipe(
      startWith(this.form.value),
      debounceTime(200),
      shareReplay(1)
    );

    const setCssProperty = (
      name: string,
      property: string,
      mapFn?: (x: string) => string
    ) => this.setCssProperty(settings$, name, property, mapFn);

    setCssProperty('width', '--field-width');
    setCssProperty('cellSize', '--cell-size', (value) => value + 'px');
    setCssProperty('cellAliveColor', '--cell-alive-bg-color');
    setCssProperty('cellDeadColor', '--cell-dead-bg-color');

    const initField$ = settings$.pipe(
      distinctUntilChanged(
        (old, n) => old.height === n.height && old.width === n.width
      ),
      map(({ height, width }) => {
        const status = Array(height * width).fill(false);
        const neighbours = new Map(
          status.map((_, index) => [
            index,
            this.getNeighbours(index, height, width),
          ])
        );

        return { status, neighbours };
      })
    );

    const start$ = this.play$.pipe(filter((play) => play));
    const stop$ = this.play$.pipe(filter((play) => !play));

    const interval$ = settings$.pipe(
      pluck('interval'),
      switchMap((time) => interval(time))
    );

    this.tick$ = start$.pipe(switchMap(() => interval$.pipe(takeUntil(stop$))));

    this.field$ = merge(
      initField$.pipe(map((field) => ({ action: 'init', payload: field }))),
      this.setStatus$.pipe(
        map((status) => ({ action: 'set-status', payload: status }))
      ),
      this.tick$.pipe(map(() => ({ action: 'tick', payload: null })))
    ).pipe(
      scan(
        (
          field: Field,
          { action, payload }: { action: string; payload: unknown }
        ) => {
          switch (action) {
            case 'init':
              return this.initAction(payload, field);
            case 'set-status':
              return this.setStatusAction(payload, field);
            case 'tick':
              return this.tickAction(payload, field);
            default:
              return field;
          }
        },
        {
          status: new Array<boolean>(),
          aliveCells: new Set(),
          deadCellsWithAliveNeighbours: new Set(),
          neighbours: new Map(),
        }
      )
    );
  }

  ngAfterViewInit(): void {
    if (!this.fieldElement?.nativeElement) {
      return;
    }

    const style = getComputedStyle(this.fieldElement.nativeElement);

    console.log({ form: this.form });

    const setFormValue = (
      control: string,
      cssVariable: string,
      mapFn = (x: string) => x
    ) => {
      this.form
        .get(control)
        ?.setValue(mapFn(style.getPropertyValue(cssVariable)));

      console.log('setFormValue', {
        control,
        cssVariable,
        ctl: this.form.get(control),
        styleValue: style.getPropertyValue(cssVariable),
      });
    };

    setFormValue('width', '--field-width');
    setFormValue('cellSize', '--cell-size', (value) => value.replace('px', ''));
    setFormValue('cellAliveColor', '--cell-alive-bg-color');
    setFormValue('cellDeadColor', '--cell-dead-bg-color');
  }

  private setCssProperty(
    settings$: Observable<any>,
    setting: string,
    cssVarName: string,
    mapFn = (x: string) => x
  ): void {
    settings$
      .pipe(
        pluck(setting),
        distinctUntilChanged(),
        takeUntil(this.unsubscribe$)
      )
      .subscribe((value) =>
        this.fieldElement?.nativeElement.style.setProperty(
          cssVarName,
          mapFn(value)
        )
      );
  }

  private tickAction(payload: unknown, field: Field) {
    return { ...field, ...this.tick(field) };
  }

  private setStatusAction(payload: unknown, field: Field) {
    {
      const { index, status } = payload as {
        index: number;
        status: boolean;
      };
      field.status[index] = status;

      const neighbours = field.neighbours.get(index)!;

      if (status) {
        field.aliveCells.add(index);
        field.deadCellsWithAliveNeighbours.delete(index);
        neighbours
          .filter((neighbour) => !field.aliveCells.has(neighbour))
          .forEach((neighbour) =>
            field.deadCellsWithAliveNeighbours.add(neighbour)
          );
      } else {
        field.aliveCells.delete(index);
        if (neighbours.some((neighbour) => field.aliveCells.has(neighbour))) {
          field.deadCellsWithAliveNeighbours.add(index);
        }
        neighbours
          .filter(
            (neighbour) =>
              !field.neighbours
                .get(neighbour)!
                .some((n) => field.aliveCells.has(n))
          )
          .forEach((deadCellWithoutAliveNeighbour) =>
            field.deadCellsWithAliveNeighbours.delete(
              deadCellWithoutAliveNeighbour
            )
          );
      }
      return field;
    }
  }

  private initAction(payload: unknown, field: Field) {
    {
      const initField = payload as {
        status: Array<boolean>;
        neighbours: Map<number, Array<number>>;
      };
      return { ...field, ...initField };
    }
  }

  private tick(
    field: Field
  ): Pick<Field, 'status' | 'aliveCells' | 'deadCellsWithAliveNeighbours'> {
    console.group(
      'tick for ',
      field.aliveCells.size + field.deadCellsWithAliveNeighbours.size,
      ' elements'
    );
    const decideStatus = (status: boolean, index: number) => {
      const aliveNeighbours = field.neighbours
        .get(index)!
        .filter((neighbour) => field.status[neighbour]).length;

      if (!status) {
        return aliveNeighbours === 3;
      } else {
        return aliveNeighbours >= 2 && aliveNeighbours <= 3;
      }
    };

    const aliveCells = new Set(
      [...field.aliveCells, ...field.deadCellsWithAliveNeighbours]
        .map((index) =>
          decideStatus(field.status[index], index) ? index : null
        )
        .filter((index) => !!index) as Array<number>
    );

    const deadCellsWithAliveNeighbours = new Set(
      Array.from(aliveCells)
        .map((index) => field.neighbours.get(index)!)
        .flat()
        .filter((neighbour) => !aliveCells.has(neighbour))
    );

    console.groupEnd();

    return {
      status: field.status.map((status, index) => aliveCells.has(index)),
      aliveCells,
      deadCellsWithAliveNeighbours,
    };
  }

  private getNeighbours(
    index: number,
    height: number,
    width: number
  ): Array<number> {
    const dimension = height * width;

    const topNeighbourOffset = index < width ? +dimension - width : -width;
    const bottomNeighbourOffset =
      index >= (height - 1) * width ? -dimension + width : +width;
    const leftNeighbourOffset = index % width === 0 ? +width - 1 : -1;
    const rightNeighbourOffset = index % width === width - 1 ? -width + 1 : +1;
    // prettier-ignore
    return [
      index + topNeighbourOffset + leftNeighbourOffset,    index + topNeighbourOffset,    index + topNeighbourOffset + rightNeighbourOffset,
      index + leftNeighbourOffset,                         index + rightNeighbourOffset,
      index + bottomNeighbourOffset + leftNeighbourOffset, index + bottomNeighbourOffset, index + bottomNeighbourOffset + rightNeighbourOffset,
    ];
  }

  trackByFieldFn(index: number, alive: boolean): number {
    return index;
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
  }
}
