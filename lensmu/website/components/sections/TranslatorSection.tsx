"use client";

import { useState, useCallback, useRef } from "react";
import {
  Upload,
  FileImage,
  FileText,
  Languages,
  Wand2,
  RefreshCcw,
  CheckCircle2,
  Loader2,
  X,
  Download
} from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ProcessState = "idle" | "uploading" | "scanning" | "translating" | "rendering" | "done" | "error";

export function TranslatorSection() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [targetLang, setTargetLang] = useState("es"); // default Spanish
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (uploadedFile: File) => {
    // Check if it's an image or pdf
    if (!uploadedFile.type.includes("image") && uploadedFile.type !== "application/pdf") {
      alert("Please upload a valid image or PDF.");
      return;
    }
    
    setFile(uploadedFile);
    if (uploadedFile.type.includes("image")) {
      const url = URL.createObjectURL(uploadedFile);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null); // PDF placeholder can be used later
    }
    setProcessState("idle");
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setProcessState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startTranslation = async () => {
    if (!file) return;
    
    // Simulate the translation pipeline
    setProcessState("uploading");
    await new Promise(resolve => setTimeout(resolve, 800));
    
    setProcessState("scanning");
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setProcessState("translating");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setProcessState("rendering");
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    setProcessState("done");
  };

  return (
    <section className="bg-background section-padding min-h-screen pt-24 md:pt-32">
      <div className="section-shell">
        <div className="mx-auto max-w-3xl text-center mb-12">
          <p className="eyebrow">Document Translator</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
            Translate files instantly.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload images, screenshots, mangas, or PDFs. Our OCR + AI pipeline 
            detects text and redraws it in your chosen language, preserving the original layout.
          </p>
        </div>

        <div className="mx-auto max-w-4xl">
          {!file ? (
            <Card
              className={cn(
                "relative flex flex-col items-center justify-center p-12 text-center border-2 border-dashed transition-colors",
                dragActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50 hover:border-primary/50",
                "min-h-[400px] rounded-2xl shadow-sm"
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={handleChange}
              />
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-6">
                <Upload className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Drag & Drop your file here</h3>
              <p className="text-muted-foreground mb-8">
                Supports JPG, PNG, WEBP, and PDF (up to 10MB)
              </p>
              <Button size="lg" className="rounded-full px-8 shadow-sm" onClick={() => fileInputRef.current?.click()}>
                Browse Files
              </Button>
            </Card>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Left Column: File Preview */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    {file.type.includes("image") ? <FileImage className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
                    Original File
                  </h3>
                  {processState === "idle" && (
                    <Button variant="ghost" size="sm" onClick={clearFile} className="h-8 text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4 mr-1" /> Remove
                    </Button>
                  )}
                </div>
                
                <Card className="flex-1 overflow-hidden bg-muted/30 border-border relative min-h-[300px] lg:min-h-[500px] flex items-center justify-center">
                  {previewUrl ? (
                    <Image 
                      src={previewUrl} 
                      alt="Upload preview" 
                      fill 
                      className={cn("object-contain p-4", processState !== "idle" && processState !== "done" && "opacity-50")}
                    />
                  ) : (
                    <div className="text-center p-6">
                      <FileText className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
                      <p className="font-medium text-foreground">{file.name}</p>
                      <p className="text-sm text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB PDF Document</p>
                    </div>
                  )}
                  
                  {/* Scanning Overlay Effect */}
                  {processState === "scanning" && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="w-full h-1 bg-primary/80 shadow-[0_0_15px_rgba(var(--primary),0.5)] animate-scan" />
                    </div>
                  )}
                </Card>
              </div>

              {/* Right Column: Settings & Result */}
              <div className="flex flex-col">
                {processState === "idle" ? (
                  <Card className="flex-1 p-6 md:p-8 flex flex-col justify-center border-border shadow-sm">
                    <h3 className="text-xl font-bold mb-6">Translation Settings</h3>
                    
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-sm font-medium">Target Language</label>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {[
                            { id: "es", label: "Spanish" },
                            { id: "fr", label: "French" },
                            { id: "ja", label: "Japanese" },
                            { id: "zh", label: "Chinese" },
                            { id: "de", label: "German" },
                            { id: "en", label: "English" },
                          ].map(lang => (
                            <button
                              key={lang.id}
                              onClick={() => setTargetLang(lang.id)}
                              className={cn(
                                "flex items-center justify-center py-2.5 rounded-lg border text-sm font-medium transition-colors",
                                targetLang === lang.id 
                                  ? "border-primary bg-primary/10 text-primary" 
                                  : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {lang.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-border/50">
                        <Button size="lg" className="w-full rounded-full shadow-md h-12 text-base" onClick={startTranslation}>
                          <Wand2 className="mr-2 h-5 w-5" />
                          Translate Document
                        </Button>
                      </div>
                    </div>
                  </Card>
                ) : processState === "done" ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-lg flex items-center gap-2 text-green-600 dark:text-green-500">
                        <CheckCircle2 className="h-5 w-5" />
                        Translation Complete
                      </h3>
                      <Button variant="ghost" size="sm" onClick={clearFile} className="h-8 text-muted-foreground">
                        <RefreshCcw className="h-4 w-4 mr-1" /> Translate Another
                      </Button>
                    </div>
                    
                    <Card className="flex-1 overflow-hidden bg-card border-border relative min-h-[300px] lg:min-h-[500px] flex items-center justify-center p-6">
                      <div className="text-center max-w-sm">
                        <div className="h-16 w-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
                        </div>
                        <h4 className="text-xl font-bold mb-2">Ready for Download</h4>
                        <p className="text-muted-foreground mb-8 text-sm">
                          Your document has been translated and the text has been seamlessly overlaid onto the original file.
                        </p>
                        <Button size="lg" className="w-full rounded-full bg-green-600 hover:bg-green-700 text-white border-0 shadow-md">
                          <Download className="h-5 w-5 mr-2" />
                          Download Result
                        </Button>
                      </div>
                    </Card>
                  </div>
                ) : (
                  <Card className="flex-1 p-8 flex flex-col items-center justify-center text-center border-border shadow-sm">
                    <div className="relative h-24 w-24 mb-8">
                      <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
                      <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Languages className="h-8 w-8 text-primary animate-pulse" />
                      </div>
                    </div>
                    
                    <h3 className="text-xl font-bold mb-2">
                      {processState === "uploading" && "Uploading securely..."}
                      {processState === "scanning" && "Running OCR extraction..."}
                      {processState === "translating" && "Translating context..."}
                      {processState === "rendering" && "Redrawing on document..."}
                    </h3>
                    
                    <p className="text-muted-foreground text-sm max-w-[250px]">
                      {processState === "uploading" && "Transferring file to secure processing servers."}
                      {processState === "scanning" && "VisionTranslate is detecting bounding boxes and text regions."}
                      {processState === "translating" && "Applying AI models to generate accurate, natural translations."}
                      {processState === "rendering" && "Stitching translated text back into the original visual layout."}
                    </p>

                    <div className="w-full max-w-xs bg-muted rounded-full h-2 mt-8 overflow-hidden">
                      <div 
                        className="bg-primary h-full transition-all duration-500 ease-out rounded-full"
                        style={{ 
                          width: processState === "uploading" ? "25%" : 
                                 processState === "scanning" ? "50%" : 
                                 processState === "translating" ? "75%" : "95%" 
                        }}
                      />
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan {
          position: absolute;
          animation: scan 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}} />
    </section>
  );
}
