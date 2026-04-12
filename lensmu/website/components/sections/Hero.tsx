import { CheckCircle2, Chrome, Play, Users } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { heroStats } from "@/data/site";

export function Hero() {
  return (
    <section
      id="home"
      className="relative isolate overflow-hidden bg-neutral-950 text-white"
    >
      <Image
        src="https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1800&q=80"
        alt="Bright city street with international signs at night"
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 -z-20 object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-neutral-950/60" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-neutral-950/70 via-neutral-950/20 to-neutral-950/75" />

      <div className="section-shell pb-10 pt-14 sm:pb-12 sm:pt-16 lg:pb-14 lg:pt-20">
        <div className="mx-auto max-w-5xl text-center">
          <Badge variant="accent" className="mb-5">
            OCR + AI translation for visual text
          </Badge>

          <h1 className="animate-fade-up mx-auto max-w-4xl text-4xl font-bold leading-[1.04] tracking-normal sm:text-5xl lg:text-7xl">
            Translate image text right where it appears.
          </h1>

          <p className="animate-fade-up-delay mx-auto mt-6 max-w-3xl text-base leading-8 text-white/80 sm:text-lg">
            VisionTranslate is a browser extension that detects
            foreign-language text inside webpage images and overlays the
            translation directly on the page.
          </p>

          <div className="animate-fade-up-delay mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="inverse" size="lg" asChild>
              <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer">
                <Chrome className="h-5 w-5" />
                Get Extension
              </a>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="border-white/40 bg-white/10 text-white hover:bg-white/20"
              asChild
            >
              <a href="/about">
                <Users className="h-5 w-5" />
                About Us
              </a>
            </Button>
          </div>
        </div>

        <div className="animate-fade-up-delay mx-auto mt-10 max-w-5xl">
          <div className="overflow-hidden rounded-lg border border-white/20 bg-neutral-950 shadow-lift">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="h-3 w-3 rounded-sm bg-secondary" />
              <span className="h-3 w-3 rounded-sm bg-accent" />
              <span className="h-3 w-3 rounded-sm bg-primary" />
              <span className="ml-3 truncate rounded-md bg-white/10 px-3 py-1 text-xs text-white/75">
                visiontranslate.app/manga-panel
              </span>
            </div>

            <div className="relative aspect-[16/8.2] min-h-[240px] overflow-hidden sm:min-h-[320px]">
              <Image
                src="https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&w=1400&q=80"
                alt="Browser mockup showing image text translated in place"
                fill
                priority
                sizes="(min-width: 1024px) 896px, 100vw"
                className="object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-neutral-950/20" />
              <div className="absolute left-[6%] top-[10%] max-w-[42%] rounded-md bg-white/95 p-3 text-left text-xs font-semibold leading-5 text-neutral-950 shadow-soft sm:text-sm">
                Original visual text detected
              </div>
              <div className="absolute bottom-[14%] right-[6%] max-w-[48%] rounded-md bg-primary p-3 text-left text-xs font-semibold leading-5 text-primary-foreground shadow-soft sm:text-sm">
                Translation appears directly on the image
              </div>
              <div className="absolute bottom-[14%] left-[6%] hidden rounded-md border border-white/30 bg-neutral-950/75 px-3 py-2 text-xs font-medium text-white backdrop-blur sm:block">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                  OCR confidence: 94%
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {heroStats.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-white/20 bg-white/10 p-4 text-left backdrop-blur"
              >
                <p className="text-lg font-bold sm:text-xl">{item.value}</p>
                <p className="mt-1 text-sm leading-5 text-white/70">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
