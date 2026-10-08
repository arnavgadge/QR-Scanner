import { Button } from '../../components/ui/Button';

interface Props {
  notice?: string | undefined;
  onTake: () => void;
  onChoose: () => void;
  onManual: () => void;
}

/** Start of the photo workflow: how to take a useful photo + take / choose buttons. */
export function PhotoCapture({ notice, onTake, onChoose, onManual }: Props) {
  return (
    <section aria-labelledby="photo-title" className="space-y-4">
      <h2 id="photo-title" className="text-lg font-bold">
        Photograph the serial
      </h2>

      {/* Visual guide: where the engraving should sit in the photo. */}
      <div
        aria-hidden="true"
        className="flex aspect-[16/7] w-full items-center justify-center rounded-lg border-4 border-dashed border-action bg-action-soft"
      >
        <div className="text-center">
          <p className="text-xs font-semibold tracking-widest text-action uppercase">
            Serial guide area
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink-muted">ABC123456</p>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-ink-muted">
        <li>Keep the whole serial inside the guide box.</li>
        <li>Keep the engraving in focus: tap the screen to focus.</li>
        <li>Avoid glare and reflections; use good lighting.</li>
        <li>Hold the camera steady and square to the part (no steep angle).</li>
        <li>
          Move close enough that every character is large and sharp, but keep the whole serial in
          view.
        </li>
        <li>Engraving is hard to see: tilt the light so the grooves show as shadows, not shine.</li>
        <li>You always check and can correct the result before anything is saved.</li>
      </ul>

      {notice && (
        <p role="alert" className="rounded-md bg-warn-soft p-3 font-semibold text-warn">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={onTake} className="min-h-16 w-full text-xl md:hidden">
          Take Photo
        </Button>
        <Button
          variant="secondary"
          onClick={onChoose}
          className="min-h-16 w-full text-xl md:min-h-14 md:text-lg"
        >
          Choose Photo
        </Button>
        <Button variant="secondary" onClick={onManual} className="min-h-14 w-full text-lg">
          Enter Manually
        </Button>
      </div>
      <p className="text-sm text-ink-muted">
        If the camera does not open (for example camera access was not allowed), use Choose Photo or
        enter the serial manually. Photos are read on this device and are not saved.
      </p>
    </section>
  );
}
