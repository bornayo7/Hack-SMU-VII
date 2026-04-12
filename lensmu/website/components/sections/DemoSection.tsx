import { ArrowRight, Play, ScanText, Video } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { RevealOnScroll } from "@/components/ui/reveal-on-scroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative overflow-hidden bg-neutral-950 text-white section-padding"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
      <div className="section-shell relative z-10">
        <RevealOnScroll className="mx-auto max-w-3xl text-center">
          <div>
            <p className="text-sm font-semibold uppercase text-accent">
              Product Showcase
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              See the extension translate visual text in real time.
            </h2>
            <p className="mt-5 text-base leading-8 text-white/70">
              This walkthrough shows VisionTranslate scanning a webpage image,
              extracting text with OCR, translating it, and placing the result
              directly over the original visual content.
            </p>
          </div>
        </RevealOnScroll>

        <RevealOnScroll
          delay="short"
          variant="scale-up"
          className="mx-auto mt-12 max-w-6xl"
        >
          <div className="group overflow-hidden rounded-lg border border-white/20 bg-white/10 shadow-lift transition duration-500 hover:-translate-y-1 hover:border-primary/60">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-secondary" />
                <span className="h-3 w-3 rounded-sm bg-accent" />
                <span className="h-3 w-3 rounded-sm bg-primary" />
                <span className="ml-2 truncate text-xs font-medium text-white/70">
                  VisionTranslate showcase playback
                </span>
              </div>
              <span className="hidden rounded-md bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground sm:inline-flex">
                Production-ready tour
              </span>
            </div>

            <div className="relative aspect-video">
              <Image
                src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1600&q=80"
                alt="VisionTranslate product tour video placeholder"
                fill
                sizes="(min-width: 1024px) 1152px, 100vw"
                className="object-cover opacity-75 transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-neutral-950/50 transition duration-700 group-hover:bg-neutral-950/40" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <a
                  href="/contact"
                  className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-md bg-white text-neutral-950 shadow-soft transition duration-300 hover:scale-105 hover:bg-accent"
                  aria-label="Watch product tour"
                >
                  <Play className="h-7 w-7" />
                </a>
                <div className="max-w-lg rounded-md border border-white/20 bg-neutral-950/75 px-4 py-3 backdrop-blur">
                  <p className="flex items-center justify-center gap-2 text-sm font-semibold">
                    <Video className="h-4 w-4" />
                    Product tour video placeholder
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/70">
                    Drop in the final YouTube, Vimeo, or local showcase video to
                    display the full experience.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/10 p-5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid gap-3 sm:grid-cols-3">
                {["Scans images", "Runs OCR", "Overlays translation"].map(
                  (item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-white/80"
                    >
                      <ScanText className="h-4 w-4 text-accent" />
                      {item}
                    </div>
                  )
                )}
              </div>
              <Button variant="inverse" size="lg" asChild>
                <a href="/contact">
                  See it in Action
                  <ArrowRight className="h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
