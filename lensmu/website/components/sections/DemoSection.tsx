import { ArrowRight, Play, ScanText, Video } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { RevealOnScroll } from "@/components/ui/reveal-on-scroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative overflow-hidden bg-muted/30 text-foreground section-padding"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="section-shell relative z-10">
        <RevealOnScroll className="mx-auto max-w-3xl text-center">
          <div>
            <p className="eyebrow">
              Product Showcase
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              See the extension translate visual text in real time.
            </h2>
            <p className="mt-5 text-base leading-8 text-muted-foreground">
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
          <div className="group overflow-hidden rounded-xl border border-border/50 bg-card shadow-lift transition duration-500 hover:-translate-y-1 hover:border-primary/50">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/50 bg-muted/50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-2 truncate text-xs font-medium text-muted-foreground">
                  VisionTranslate showcase playback
                </span>
              </div>
              <span className="hidden rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold sm:inline-flex">
                Production-ready tour
              </span>
            </div>

            <div className="relative aspect-video">
              <Image
                src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1600&q=80"
                alt="VisionTranslate product tour video placeholder"
                fill
                sizes="(min-width: 1024px) 1152px, 100vw"
                className="object-cover opacity-90 transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-background/20 transition duration-700 group-hover:bg-background/10" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <a
                  href="/contact"
                  className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow transition duration-300 hover:scale-110"
                  aria-label="Watch product tour"
                >
                  <Play className="h-7 w-7 ml-1" />
                </a>
                <div className="max-w-lg rounded-xl border border-border/50 bg-background/80 px-5 py-4 backdrop-blur-md shadow-sm">
                  <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
                    <Video className="h-4 w-4 text-primary" />
                    Product tour video placeholder
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Drop in the final YouTube, Vimeo, or local showcase video to
                    display the full experience.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-t border-border/50 bg-muted/20 p-5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid gap-3 sm:grid-cols-3">
                {["Scans images", "Runs OCR", "Overlays translation"].map(
                  (item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm"
                    >
                      <ScanText className="h-4 w-4 text-primary" />
                      {item}
                    </div>
                  )
                )}
              </div>
              <Button variant="default" size="lg" className="rounded-full shadow-glow" asChild>
                <a href="/contact">
                  See it in Action
                  <ArrowRight className="h-5 w-5 ml-2" />
                </a>
              </Button>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
