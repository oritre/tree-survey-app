;;; sheets.lsp - put a drawing from model space on a layout sheet with a title block (shoval), at a chosen scale.
;;;
;;; Commands
;;;   SHEET       new layout: choose title block type and scale, pick the drawing in model space
;;;               (window / closed polyline / moving frame of a paper size). The sheet size is chosen by itself:
;;;               the smallest of A4..A0 (landscape or portrait) that holds the drawing and the title block,
;;;               otherwise a roll sheet ("gramoshka") of free size, up to 900 x 5000 mm.
;;;               With one drawing the viewport fills the frame up to the title block; the paper is still chosen by
;;;               the picked part, which stays in the middle. The layout is named by paper and scale ("A3 1-250").
;;;   SHEETADD    add another drawing (own scale) to an existing sheet:
;;;               Inside - click where it goes (flush with the frame / title block when close); the paper stays and
;;;                        the other drawings are cut around it, with a thin frame around the new one (an inset);
;;;               Beside - left / right / above / below / click; the sheet grows to hold all drawings.
;;;   SHEETSCALE  change the scale of a drawing on the current sheet; the sheet size is fitted again.
;;;   SHEETFIT    fit the current sheet again: size, frame, title block, centering, inset cuts. Viewports stretched
;;;               by hand keep their size; edges within 5 mm of the frame or the title block go onto it.
;;;   SHEETPAN    move what a drawing shows: click inside it, then a point and where it goes (again and again,
;;;               Enter when done). The scale stays.
;;;
;;; The viewports are not locked: double-click into one to pan or wheel-zoom. SHEETFIT (and the other commands)
;;; read the scale and view each viewport has now; a scale within 0.5% of a whole number is set exactly to it and
;;; written in the title block.
;;;   SHEETFILL   grow every drawing to the frame, the title block or the next drawing (scale and middle stay).
;;;   SHEETUNITS  the drawing units (meters / centimeters / millimeters), kept in the drawing. Asked once by the
;;;               first SHEET when not certain (local coordinates with INSUNITS 0 or 5); grid coordinates are meters.
;;;   SHEETSIZE   force a sheet size on the current sheet (A4..A0, landscape/portrait, custom W x H) or back to Auto.
;;;   SHEETBLOCK  choose which block is the title block of each type, and save it to the title block library.
;;;
;;; While picking a frame (SHEET -> Frame): the frame follows the cursor. Type a scale and Enter (e.g. 500),
;;; + / - next / previous common scale, S next paper size, O landscape/portrait, R align to a line, click to place.
;;;
;;; Rotated drawings: if the UCS is rotated when you pick, the drawing is picked in the UCS directions and the
;;; viewport is turned the same way (like UCS + PLAN). Option Rotate: pick two points of a line that should be
;;; horizontal on the sheet.
;;;
;;; The title block is inserted at paper size (1 drawing unit = 1 mm) as one block insert, so editing the block
;;; changes every sheet. Its scale text ("1:250"), paper size text ("A4"..) and dates become attributes (SCALE,
;;; SIZE, DATE, DATE2) once per drawing, and are filled in by themselves. Older sheets with an exploded title block
;;; get the block back on SHEETFIT. Parts of the block far from the rest are ignored when placing it.
;;; Model units: meters (any INSUNITS except 4 = millimeters and 1 = inches; 5 is taken as meters too).
;;; Plotter: "Print As PDF.pc3" (or the first plotter with PDF in its name). For a roll sheet the plotter needs a
;;; paper of that size; if it has none you get a message (add a custom paper size in the plotter configuration).

(vl-load-com)

;; title block library: the "sheets" folder next to sheets.lsp. The only place to change when the folder moves.
(setq *sh-libdir* "G:/האחסון שלי/PyCharmMiscProject/bricscad/sheets/")

(setq *sh-app* "ORISHEET")
(setq *sh-papers* '(("A4" 297.0 210.0) ("A3" 420.0 297.0) ("A2" 594.0 420.0) ("A1" 841.0 594.0) ("A0" 1189.0 841.0)))
(setq *sh-scales* '(50 100 200 250 500 750 1000 1250 2000 2500 5000 10000))
(setq *sh-roll-max-short* 900.0)
(setq *sh-roll-max-long* 5000.0)
(setq *sh-roll-min* 297.0)
(setq *sh-inset* 3.0)    ; title block distance from the frame (mm)
(setq *sh-gap* 15.0)     ; distance between drawings on one sheet (mm)
;; type -> default title block
(setq *sh-types* '(("Construction" . "shoval") ("Tabaa" . "shoval_mavat") ("None" . "")))
(setq *sh-frame-layer* '("SHEET-FRAME" 7 T))
(setq *sh-vp-layer* '("SHEET-VP" 8 nil))   ; not plotted
(setq *sh-device* "Print As PDF.pc3")
(if (not *sh-last-type*) (setq *sh-last-type* "Construction"))
(if (not *sh-last-scale*) (setq *sh-last-scale* 250))
(if (not *sh-last-paper*) (setq *sh-last-paper* "A4"))   ; the moving frame starts from the smallest paper
(if (not *sh-last-orient*) (setq *sh-last-orient* "L"))
(setq *sh-stripsize* nil) ; cache: ((block x0 y0 x1 y1) ...)
(setq *sh-loose* nil)     ; cache: ((block (offset entity-data insertion-point) ...) ...)

;; ---------- small helpers ----------

(defun sh:doc () (vla-get-ActiveDocument (vlax-get-acad-object)))

(defun sh:list (v)
  (if (= (type v) 'variant) (setq v (vlax-variant-value v)))
  (if (= (type v) 'safearray) (vlax-safearray->list v) v))

(defun sh:layer (spec)
  (if (not (tblsearch "LAYER" (car spec)))
    (entmake (list '(0 . "LAYER") '(100 . "AcDbSymbolTableRecord") '(100 . "AcDbLayerTableRecord")
                   (cons 2 (car spec)) '(70 . 0) (cons 62 (cadr spec)) '(6 . "Continuous")
                   (cons 290 (if (caddr spec) 1 0)))))
  (car spec))

;; millimeters on paper per model unit. INSUNITS 4 = mm, 1 = inch, other than 5 = meters. INSUNITS 5 (cm) is
;; doubtful: survey drawings in Israeli grid coordinates are in meters even when it says cm, an architect's
;; drawing in local coordinates is really in cm. Decided once per drawing (kept in the drawing): by the first
;; drawing picked, or by the sheets already made.
(defun sh:upm (/ u)
  (setq u (getvar "INSUNITS"))
  (cond (*sh-upm*)
        ;; chosen for this drawing (asked once, or SHEETUNITS)
        ((setq *sh-upm* (vlax-ldata-get "ORISHEET" "upm")))
        ((= u 4) 1.0) ((= u 1) 25.4) ((not (member u '(0 5))) 1000.0)
        ((setq *sh-upm* (sh:upm-from-sheets)))
        ;; nothing picked yet: by where the model view is
        ((and (= (getvar "TILEMODE") 1) (sh:itm-p (trans (getvar "VIEWCTR") 1 0))) 1000.0)
        ((= u 5) 10.0)
        (T 1000.0)))

(setq *sh-unitnames* '(("Meters" . 1000.0) ("Centimeters" . 10.0) ("Millimeters" . 1.0)))

(defun sh:unitname (v / r)
  (foreach a *sh-unitnames* (if (equal (cdr a) v 1e-9) (setq r (car a))))
  (if r r "Meters"))

;; ask the drawing units and keep them in the drawing
(defun sh:askunits (guess / k)
  (initget "Meters Centimeters Millimeters")
  (setq k (getkword (strcat "\nDrawing units [Meters/Centimeters/Millimeters] <" (sh:unitname guess) ">: ")))
  (setq *sh-upm* (if k (cdr (assoc k *sh-unitnames*)) guess))
  (vlax-ldata-put "ORISHEET" "upm" *sh-upm*)
  *sh-upm*)

;; Israeli grid (ITM) coordinates in meters
(defun sh:itm-p (p) (and (< 100000.0 (car p) 300000.0) (< 350000.0 (cadr p) 850000.0)))

(defun sh:upm-from-sheets (/ ss x)
  (if (and (setq ss (ssget "_X" (list '(0 . "VIEWPORT") (list -3 (list *sh-app*)))))
           (setq x (sh:reals (ssname ss 0))))
    (if (sh:itm-p (list (nth 1 x) (nth 2 x))) 1000.0 10.0)))

;; at the first pick in a drawing: grid coordinates are meters; with local coordinates and INSUNITS 0 or 5
;; (unitless / cm) the units are not certain, so they are asked once (the guess is the default)
(defun sh:setunits (cW / u)
  (setq u (getvar "INSUNITS"))
  (if (null (vlax-ldata-get "ORISHEET" "upm"))
    (cond ((sh:itm-p cW) (setq *sh-upm* 1000.0) (vlax-ldata-put "ORISHEET" "upm" *sh-upm*))
          ((member u '(0 5)) (sh:askunits (if (= u 5) 10.0 1000.0))))))

;; the drawing would not fit on any paper (larger than a 900 x 5000 mm roll): the units are probably wrong.
;; -> T to go on
;; pick = (sel scale forced). Too big for any paper: offer a smaller scale (the first that fits), the units, go on
;; anyway or cancel. -> the pick (maybe with another scale) or nil
(defun sh:checkpick (pick / big w h s k sug n)
  (setq big T)
  (while (and pick big)
    (setq s (cadr pick) w (* (sh:k s) (cadr (car pick))) h (* (sh:k s) (caddr (car pick))))
    (if (or (> (max w h) *sh-roll-max-long*) (> (min w h) *sh-roll-max-short*))
      (progn
        (setq sug nil)
        (foreach c *sh-scales*
          (if (and (null sug) (> c s)
                   (<= (* (max w h) (/ (float s) c)) *sh-roll-max-long*) (<= (* (min w h) (/ (float s) c)) *sh-roll-max-short*))
            (setq sug c)))
        (princ (strcat "\nAt 1:" (itoa s) " the drawing is " (rtos w 2 0) " x " (rtos h 2 0)
                       " mm on paper, larger than any sheet (roll up to 900 x 5000). Units: " (sh:unitname (sh:upm)) "."))
        (initget "Scale Units Continue Cancel")
        (setq k (getkword (strcat "\n[Scale" (if sug (strcat " 1:" (itoa sug)) "") "/Units/Continue/Cancel] <Scale>: ")))
        (cond ((or (null k) (= k "Scale"))
               (setq n (getint (strcat "\nScale 1: <" (itoa (if sug sug (* 2 s))) ">: ")))
               (setq pick (list (car pick) (if (and n (> n 0)) n (if sug sug (* 2 s))) (caddr pick))))
              ((= k "Units") (sh:askunits (sh:upm)))
              ((= k "Continue") (setq big nil))
              (T (setq pick nil))))
      (setq big nil)))
  (if pick (setq *sh-last-scale* (cadr pick)))
  pick)

;; change the drawing units later
(defun c:SHEETUNITS ()
  (sh:begin)
  (sh:askunits (sh:upm))
  (princ (strcat "\nDrawing units: " (sh:unitname (sh:upm)) ". Run SHEETFIT on existing sheets to update their scale."))
  (sh:end))

(defun sh:k (scale) (/ (sh:upm) (float scale)))

(defun sh:today () (menucmd "M=$(edtime,$(getvar,date),DD/MO/YYYY)"))

(defun sh:blockfor (typ / v)
  (setq v (getenv (strcat "OriSheet" typ)))
  (if (and v (/= v "")) v (cdr (assoc typ *sh-types*))))

(defun sh:libdir (/ d)
  (if (and *sh-libdir* (/= *sh-libdir* ""))
    (progn (setq d (vl-string-right-trim "/\\" *sh-libdir*))
           (vl-mkdir d)
           (strcat d "/"))))

;; make sure the block is in the drawing; from the library if needed. Returns T when it is.
(defun sh:ensureblock (blk / d f)
  (cond ((or (null blk) (= blk "")) nil)
        ((tblsearch "BLOCK" blk) T)
        ((and (setq d (sh:libdir)) (setq f (findfile (strcat d blk ".dwg"))))
         (vla-Delete (vla-InsertBlock (vla-get-ModelSpace (sh:doc)) (vlax-3d-point 0 0 0) f 1.0 1.0 1.0 0.0))
         (if (tblsearch "BLOCK" blk) T))
        ((setq f (findfile (strcat blk ".dwg")))
         (vla-Delete (vla-InsertBlock (vla-get-ModelSpace (sh:doc)) (vlax-3d-point 0 0 0) f 1.0 1.0 1.0 0.0))
         (if (tblsearch "BLOCK" blk) T))))

;; ---------- xdata ----------

;; through ActiveX: entmod does not keep xdata on viewports in BricsCAD
(defun sh:tag (e vals / l codes data)
  (if (not (tblsearch "APPID" *sh-app*)) (regapp *sh-app*))
  ;; made while fitting a sheet beside the first one: belongs to that sheet
  (if (and *sh-cur* (wcmatch *sh-cur* "s:*") (not (member (cons 1000 *sh-cur*) vals)))
    ;; after the other roles (a frame's roles are read by position), before the numbers
    (setq vals (append (vl-remove-if-not '(lambda (q) (= (car q) 1000)) vals) (list (cons 1000 *sh-cur*))
                       (vl-remove-if '(lambda (q) (= (car q) 1000)) vals))))
  (setq l (cons (cons 1001 *sh-app*) vals))
  (setq codes (vlax-make-safearray vlax-vbInteger (cons 0 (1- (length l))))
        data (vlax-make-safearray vlax-vbVariant (cons 0 (1- (length l)))))
  (vlax-safearray-fill codes (mapcar 'car l))
  (vlax-safearray-fill data (mapcar '(lambda (x) (vlax-make-variant (cdr x))) l))
  (vla-SetXData (vlax-ename->vla-object e) codes data)
  e)

(defun sh:xd (e / x)
  (setq x (assoc -3 (entget e (list *sh-app*))))
  (if x (cdr (assoc *sh-app* (cdr x)))))

(defun sh:roles (e) (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 1000)) (sh:xd e))))
(defun sh:reals (e) (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 1040)) (sh:xd e))))

;; tagged entities of a layout whose first role is in roles (nil = all)
;; (only those of the sheet *sh-cur* when it is set: "" the first sheet, "s:2".. sheets added beside it)
(defun sh:items (lay roles / ss i e r)
  (if (setq ss (ssget "_X" (list (cons 410 lay) (list -3 (list *sh-app*)))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (and (or (null roles) (member (car (sh:roles e)) roles))
               (or (null *sh-cur*) (= (sh:sheetkey e) *sh-cur*)))
        (setq r (cons e r)))))
  r)

;; the sheet an item belongs to: "" or "s:2", "s:3".. (a complete sheet beside the first one, same layout)
(defun sh:sheetkey (e / r)
  (setq r (car (vl-remove-if-not '(lambda (q) (wcmatch q "s:*")) (sh:roles e))))
  (if r r ""))

;; ---------- geometry ----------

(defun sh:bbox (ents / mn mx a b o)
  (foreach e ents
    (setq o (vlax-ename->vla-object e))
    (if (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-GetBoundingBox (list o 'a 'b))))
      (progn (setq a (vlax-safearray->list a) b (vlax-safearray->list b))
             (setq mn (if mn (mapcar 'min mn a) a) mx (if mx (mapcar 'max mx b) b)))))
  (if mn (list mn mx)))

(defun sh:move (ents dx dy / p q)
  (setq p (vlax-3d-point 0 0 0) q (vlax-3d-point dx dy 0))
  (foreach e ents (vla-Move (vlax-ename->vla-object e) p q)))

(defun sh:vpcenter (e) (cdr (assoc 10 (entget e))))
(defun sh:clip (e / c) (setq c (cdr (assoc 340 (entget e)))) (if (and c (entget c)) c))

;; move a viewport and its clip boundary together, whichever way the program links them
(defun sh:movevp (e dx dy / cl c0 v0 c2)
  (setq cl (sh:clip e) c0 (sh:vpcenter e))
  (if cl (setq v0 (cdr (assoc 10 (entget cl)))))
  (sh:move (list e) dx dy)
  (if (and cl (equal v0 (cdr (assoc 10 (entget cl))) 1e-6))
    (progn (sh:move (list cl) dx dy)
           (setq c2 (sh:vpcenter e))
           (if (not (equal c2 (list (+ (car c0) dx) (+ (cadr c0) dy) (caddr c0)) 1e-6))
             (sh:move (list e) (- (+ (car c0) dx) (car c2)) (- (+ (cadr c0) dy) (cadr c2)))))))

(defun sh:rect (x0 y0 x1 y1 lay layer / e)
  (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(67 . 1) (cons 410 lay) (cons 8 layer)
                 '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1) '(43 . 0.0)
                 (list 10 x0 y0) (list 10 x1 y0) (list 10 x1 y1) (list 10 x0 y1)))
  (entlast))

(defun sh:line (x0 y0 x1 y1 lay layer)
  (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(67 . 1) (cons 410 lay) (cons 8 layer)
                 (list 10 x0 y0 0.0) (list 11 x1 y1 0.0)))
  (entlast))

;; ---------- paper sizes ----------

(defun sh:margin (name pw ph) (cond ((= name "ROLL") 10.0) ((< (min pw ph) 250) 7.0) (T 10.0)))
(defun sh:pad (name pw ph / s)
  (setq s (min pw ph))
  (cond ((= name "ROLL") 15.0) ((< s 250) 6.0) ((< s 350) 8.0) ((< s 500) 10.0) ((< s 700) 12.0) (T 15.0)))
(defun sh:col (sw) (if (> sw 0) (+ sw (* 2 *sh-inset*)) 0.0))

;; usable drawing area of a paper: (w h)
;; drawing area inside the frame, beside the title block (the viewport fills it, so no inner padding)
(defun sh:usable (name pw ph sw shh / m)
  (setq m (sh:margin name pw ph))
  (list (- pw (* 2 m) (sh:col sw)) (- ph (* 2 m))))

;; the picked part fits the drawing area, 3% allowed over (a little more around it is shown anyway)
(defun sh:fits (name pw ph gw gh sw shh / u)
  (setq u (sh:usable name pw ph sw shh))
  (and (<= gw (* 1.03 (car u))) (<= gh (* 1.03 (cadr u)))
       (<= (+ shh (* 2 *sh-inset*)) (- ph (* 2 (sh:margin name pw ph))))))

(defun sh:up10 (v) (* 10.0 (fix (+ (/ v 10.0) 0.9999))))

;; smallest paper for the content -> (name pw ph)
(defun sh:choose (gw gh sw shh / r w h m p)
  (foreach s *sh-papers*
    (if (not r)
      (cond ((sh:fits (car s) (cadr s) (caddr s) gw gh sw shh) (setq r (list (car s) (cadr s) (caddr s))))
            ((sh:fits (car s) (caddr s) (cadr s) gw gh sw shh) (setq r (list (car s) (caddr s) (cadr s)))))))
  (if (not r)
    (progn
      (setq m (sh:margin "ROLL" 0 0) p (sh:pad "ROLL" 0 0))
      (setq h (sh:up10 (max *sh-roll-min* (+ gh (* 2 p) (* 2 m)) (+ shh (* 2 *sh-inset*) (* 2 m))))
            w (sh:up10 (max *sh-roll-min* (+ gw (* 2 p) (* 2 m) (sh:col sw)))))
      (setq r (list "ROLL" w h))))
  r)

;; forced size string: "" auto, "A3L" / "A3P", or "W,H" -> (name pw ph) or nil
(defun sh:forced (s / a n)
  (cond ((or (null s) (= s "")) nil)
        ((setq a (assoc (substr s 1 2) *sh-papers*))
         (if (= (substr s 3 1) "P") (list (car a) (caddr a) (cadr a)) (list (car a) (cadr a) (caddr a))))
        ((setq n (vl-string-search "," s))
         (list "ROLL" (atof (substr s 1 n)) (atof (substr s (+ n 2)))))))

(defun sh:papername (paper)
  (if (= (car paper) "ROLL")
    (strcat (rtos (cadr paper) 2 0) "x" (rtos (caddr paper) 2 0))
    (car paper)))

;; ---------- title block ----------

;; the title block parts that belong together: a part far from the rest (a stray symbol in the block) is left
;; out -> (kept dropped)
(defun sh:cluster (ents / cs mx my keep drop bb c n)
  (foreach e ents
    (if (setq bb (sh:bbox (list e)))
      (setq cs (cons (list e (/ (+ (car (car bb)) (car (cadr bb))) 2.0) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)) cs))
      (setq keep (cons e keep))))
  (if cs
    (progn
      (setq n (/ (length cs) 2)
            mx (nth n (vl-sort (mapcar 'cadr cs) '<))
            my (nth n (vl-sort (mapcar 'caddr cs) '<)))
      (foreach c cs
        (if (and (< (abs (- (cadr c) mx)) 500.0) (< (abs (- (caddr c) my)) 500.0))
          (setq keep (cons (car c) keep))
          (setq drop (cons (car c) drop))))))
  (list keep drop))

;; The title block stays one block insert on every sheet, so a change in the block shows on all sheets. The
;; texts that differ per sheet are attributes: SCALE ("1:250"), SIZE ("A4".."A0"), DATE / DATE2 (dates).
;; sh:prepblock turns those texts of the block definition into attributes, once per drawing (ATTSYNC keeps the
;; inserts that are already there).
(defun sh:prepblock (blk / bd o s tag todo n ad i)
  (setq bd (vla-Item (vla-get-Blocks (sh:doc)) blk))
  (vlax-for o bd
    (if (and (= (vla-get-ObjectName o) "AcDbAttributeDefinition") (= (strcase (vla-get-TagString o)) "SCALE"))
      (setq n T)))
  (if (not n)
    (progn
      (setq n 0)
      (vlax-for o bd
        (if (= (vla-get-ObjectName o) "AcDbText")
          (progn
            (setq s (vla-get-TextString o) tag nil)
            (cond ((and (= s "1:250") (not (assoc "SCALE" todo))) (setq tag "SCALE"))
                  ((and (member s '("A4" "A3" "A2" "A1" "A0")) (not (assoc "SIZE" todo))) (setq tag "SIZE"))
                  ((or (= s "XX/XX/XXXX") (wcmatch s "#*/#*/####"))
                   (setq tag (if (assoc "DATE" todo) (strcat "DATE" (itoa (+ 2 (setq n (1+ n))))) "DATE"))
                   (if (= tag "DATE3") (setq tag "DATE2"))))
            (if tag (setq todo (cons (cons tag o) todo))))))
      (foreach t1 todo
        (setq o (cdr t1)
              ad (vla-AddAttribute bd (vla-get-Height o) acAttributeModeNormal (car t1)
                                   (vla-get-InsertionPoint o) (car t1) (vla-get-TextString o)))
        (foreach p '(StyleName ScaleFactor Rotation ObliqueAngle Layer Color)
          (vl-catch-all-apply 'vlax-put-property (list ad p (vlax-get-property o p))))
        (if (/= (vla-get-Alignment o) acAlignmentLeft)
          (progn (vla-put-Alignment ad (vla-get-Alignment o))
                 (vla-put-TextAlignmentPoint ad (vla-get-TextAlignmentPoint o))))
        (vla-Delete o))
      (if todo (vl-catch-all-apply 'vl-cmdf (list "_.ATTSYNC" "_N" blk)))))
  T)

;; box of the title block around its insertion point (block units = mm), without far stray parts: (x0 y0 x1 y1)
(defun sh:stripbox (blk / c ref bb objs)
  (cond ((or (null blk) (= blk "")) nil)
        ((setq c (assoc blk *sh-stripsize*)) (cdr c))
        ((and (sh:ensureblock blk) (sh:prepblock blk))
         (setq ref (vla-InsertBlock (vla-get-ModelSpace (sh:doc)) (vlax-3d-point 0 0 0) blk 1.0 1.0 1.0 0.0))
         (setq objs (mapcar 'vlax-vla-object->ename (sh:list (vla-Explode ref))))
         (vla-Delete ref)
         (setq bb (sh:bbox (car (sh:cluster objs))))
         (foreach e objs (entdel e))
         (setq c (list (car (car bb)) (cadr (car bb)) (car (cadr bb)) (cadr (cadr bb))))
         (setq *sh-stripsize* (cons (cons blk c) *sh-stripsize*))
         c)))

(defun sh:stripsize (blk / b)
  (if (setq b (sh:stripbox blk)) (list (- (nth 2 b) (nth 0 b)) (- (nth 3 b) (nth 1 b))) '(0.0 0.0)))

;; the title block parts on a sheet -> their box ((x0 y0) (x1 y1))
(defun sh:stripbb (strip / e ip b)
  (setq e (car (vl-remove-if-not '(lambda (s) (= (cdr (assoc 0 (entget s))) "INSERT")) strip)))
  (if (and e (null (vl-remove-if '(lambda (s) (or (equal s e) (sh:loose-p s))) strip))
           (setq b (sh:stripbox (vla-get-EffectiveName (vlax-ename->vla-object e)))))
    (progn (setq ip (cdr (assoc 10 (entget e))))
           (list (list (+ (car ip) (nth 0 b)) (+ (cadr ip) (nth 1 b)) 0.0) (list (+ (car ip) (nth 2 b)) (+ (cadr ip) (nth 3 b)) 0.0)))
    (sh:bbox (car (sh:cluster strip)))))

(defun sh:attset (ins tag val)
  (foreach a (vlax-invoke (vlax-ename->vla-object ins) 'GetAttributes)
    (if (wcmatch (strcase (vla-get-TagString a)) tag) (vla-put-TextString a val))))

(defun sh:attget (ins tag / r)
  (foreach a (vlax-invoke (vlax-ename->vla-object ins) 'GetAttributes)
    (if (= (strcase (vla-get-TagString a)) tag) (setq r (vla-get-TextString a))))
  r)

;; insert the title block in the current layout (one block insert), dates filled. Returns the insert.
(defun sh:addstrip (blk lay / ref e)
  (if (and (sh:ensureblock blk) (sh:prepblock blk))
    (progn
      (setq ref (vla-InsertBlock (vla-get-PaperSpace (sh:doc)) (vlax-3d-point 0 0 0) blk 1.0 1.0 1.0 0.0)
            e (vlax-vla-object->ename ref))
      (vla-put-Layer ref "0")
      (sh:tag e (list (cons 1000 "strip")))
      (sh:attset e "DATE*" (sh:today))
      e)
    (progn (princ (strcat "\nTitle block \"" blk "\" not found in this drawing or in the library (SHEETBLOCK)."))
           nil)))

;; Loose texts that lie on the title block in the drawing but are not part of the block (the sheet number in the
;; gap of "גיליון    מתוך 3", notes): taken from the first insert of the block that has some, as
;; ((offset-from-insertion-point entity-data) ...). Kept per drawing.
(defun sh:loosetexts (blk / ss tx i j e ed ip b bb t1 td p r)
  (cond ((assoc blk *sh-loose*) (cdr (assoc blk *sh-loose*)))
        (T
         (if (and (setq b (sh:stripbox blk))
                  (setq ss (ssget "_X" (list '(0 . "INSERT") (cons 2 blk))))
                  (setq tx (ssget "_X" '((0 . "TEXT,MTEXT")))))
           (repeat (setq i (sslength ss))
             (setq e (ssname ss (setq i (1- i))) ed (entget e) ip (cdr (assoc 10 ed)))
             (if (and (null r) (null (sh:xd e)) (equal (cdr (assoc 41 ed)) 1.0 1e-6) (equal (cdr (assoc 50 ed)) 0.0 1e-6))
               (progn
                 (setq bb (list (+ (car ip) (nth 0 b)) (+ (cadr ip) (nth 1 b)) (+ (car ip) (nth 2 b)) (+ (cadr ip) (nth 3 b))))
                 (repeat (setq j (sslength tx))
                   (setq t1 (ssname tx (setq j (1- j))) td (entget t1) p (cdr (assoc 10 td)))
                   (if (and (= (cdr (assoc 410 td)) (cdr (assoc 410 ed))) (null (sh:xd t1))
                            (<= (nth 0 bb) (car p) (nth 2 bb)) (<= (nth 1 bb) (cadr p) (nth 3 bb)))
                     (setq r (cons (list (mapcar '- p ip) td ip) r))))))))
         ;; none in this drawing: the sheet number where it is in ori's title blocks
         (if (and (null r) (setq b (assoc blk *sh-sheetno-default*)))
           (setq r (list (list (cadr b) (list '(0 . "TEXT") '(100 . "AcDbEntity") (cons 8 (if (tblsearch "LAYER" (nth 5 b)) (nth 5 b) "0"))
                                               '(100 . "AcDbText") (cons 10 (cadr b)) (cons 40 (caddr b)) '(1 . "1")
                                               (cons 7 (if (tblsearch "STYLE" (nth 4 b)) (nth 4 b) "Standard")) '(100 . "AcDbText"))
                               '(0.0 0.0 0.0)))))
         (setq *sh-loose* (cons (cons blk r) *sh-loose*))
         r)))

;; sheet number text of the title blocks: (block offset-from-insertion height - style layer)
(setq *sh-sheetno-default*
      '(("shoval" (-26.0354 -12.6208 0.0) 2.12698 nil "NewStyle3" "0")
        ("shoval_mavat" (-34.5230 -29.1909 0.0) 2.0 nil "Standard" "tree_survey")))

;; the next sheet number in this drawing (after the sheet numbers already placed)
(defun sh:nextsheetno (/ ss i e n)
  (setq n 0)
  (if (setq ss (ssget "_X" (list '(0 . "TEXT") (list -3 (list *sh-app*)))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (member "sheetno" (sh:roles e)) (setq n (max n (atoi (cdr (assoc 1 (entget e)))))))))
  (1+ n))

;; copy the loose texts onto the title block insert ins; a text that is just a number is the sheet number:
;; asked (default: the next one). Tagged as part of the title block, so they move with it.
(defun sh:addloose (ins lay unit / blk ip lst no ed d new e)
  (setq blk (vla-get-EffectiveName (vlax-ename->vla-object ins)) ip (cdr (assoc 10 (entget ins))))
  (foreach l (sh:loosetexts blk)
    (setq ed (cadr l) d (mapcar '- ip (caddr l)))
    (if (wcmatch (cdr (assoc 1 ed)) "#,##,###")
      (progn
        (if (null no)
          (progn (setq no (getstring (strcat "\nSheet number <" (itoa (sh:nextsheetno)) ">: ")))
                 (if (= no "") (setq no (itoa (sh:nextsheetno))))))
        (setq ed (subst (cons 1 no) (assoc 1 ed) ed))))
    ;; same text, moved by the offset between the model title block and this one, in this layout
    (setq new (vl-remove-if '(lambda (q) (member (car q) '(-1 5 330 360 102 -3 67 410))) ed))
    (setq new (mapcar '(lambda (q) (if (member (car q) '(10 11)) (cons (car q) (mapcar '+ (cdr q) d)) q)) new))
    (if (entmake (append new (list '(67 . 1) (cons 410 lay))))
      (progn
        (setq e (entlast))
        (sh:tag e (append (list (cons 1000 "strip") (cons 1000 (if (= (cdr (assoc 1 new)) no) "sheetno" "loose")))
                          (if (and unit (/= unit "")) (list (cons 1000 unit)))))))))

;; sheets made by older versions have the title block exploded: put the block back, with the values they had
(defun sh:loose-p (e) (or (member "sheetno" (sh:roles e)) (member "loose" (sh:roles e))))

(defun sh:migrate (lay typ strip / old date e blk loose)
  (setq loose (vl-remove-if-not 'sh:loose-p strip) strip (vl-remove-if 'sh:loose-p strip))
  (if (vl-remove-if '(lambda (s) (= (cdr (assoc 0 (entget s))) "INSERT")) strip)
    (progn
      (foreach s strip
        (if (= (cadr (sh:roles s)) "date") (setq date (cdr (assoc 1 (entget s))))))
      (setq old (sh:stripbb strip) blk (sh:blockfor typ))
      (if (and (/= blk "") (setq e (sh:addstrip blk lay)))
        (progn
          (foreach s strip (entdel s))
          (if date (sh:attset e "DATE*" date))
          ;; where the old one was (fit puts it in the corner anyway)
          (sh:move (list e) (- (car (cadr old)) (car (cadr (sh:stripbb (list e)))))
                            (- (cadr (cadr old)) (cadr (cadr (sh:stripbb (list e))))))
          (setq strip (list e))))))
  (append strip loose))

(defun sh:settext (lay sub val / ed)
  (foreach e (sh:items lay '("strip"))
    (cond ((= (cdr (assoc 0 (entget e))) "INSERT") (sh:attset e (strcase sub) val))
          ((= (cadr (sh:roles e)) sub)
           (setq ed (entget e)) (entmod (subst (cons 1 val) (assoc 1 ed) ed))))))

;; ---------- plot settings ----------

(defun sh:nums (s / i c tok r)
  (setq i 1 tok "")
  (while (<= i (1+ (strlen s)))
    (setq c (if (<= i (strlen s)) (substr s i 1) " "))
    (if (or (wcmatch c "#") (= c "."))   ; not "#,." - in wcmatch "." is any non-alphanumeric character
      (setq tok (strcat tok c))
      (progn (if (and (/= tok "") (/= tok ".")) (setq r (cons (atof tok) r))) (setq tok "")))
    (setq i (1+ i)))
  (reverse r))

;; best paper of that size: full bleed first, then the same orientation (no plot rotation)
(defun sh:findmedia (lo pw ph / best bs n a b s)
  (foreach m (sh:list (vla-GetCanonicalMediaNames lo))
    (if (wcmatch (strcase m) "*MM*")
      (progn
        (setq n (reverse (sh:nums m)))
        (if (>= (length n) 2)
          (progn (setq a (cadr n) b (car n))
                 (if (or (and (equal a pw 1.0) (equal b ph 1.0)) (and (equal a ph 1.0) (equal b pw 1.0)))
                   (progn
                     (setq s (+ (if (wcmatch (strcase m) "*FULL*BLEED*") 2 0) (if (equal a pw 1.0) 1 0)))
                     (if (or (null best) (> s bs)) (setq best m bs s)))))))))
  best)

;; no paper of that size (roll sheets): the smallest paper that holds the sheet
(defun sh:covermedia (lo pw ph / best ba n a b)
  (foreach m (sh:list (vla-GetCanonicalMediaNames lo))
    (if (wcmatch (strcase m) "*MM*")
      (progn
        (setq n (reverse (sh:nums m)))
        (if (>= (length n) 2)
          (progn (setq a (cadr n) b (car n))
                 (if (and (or (and (>= a (- pw 0.5)) (>= b (- ph 0.5))) (and (>= a (- ph 0.5)) (>= b (- pw 0.5))))
                          (or (null best) (< (* a b) ba)))
                   (setq best m ba (* a b))))))))
  best)

(defun sh:plot (pw ph / lo dev l media w h exact)
  (setq lo (vla-get-ActiveLayout (sh:doc)))
  (vl-catch-all-apply 'vla-RefreshPlotDeviceInfo (list lo))
  (setq l (sh:list (vl-catch-all-apply 'vla-GetPlotDeviceNames (list lo))))
  (if (listp l)
    (setq dev (cond ((car (vl-member-if '(lambda (x) (= (strcase x) (strcase *sh-device*))) l)))
                    ((car (vl-member-if '(lambda (x) (wcmatch (strcase x) "*PDF*")) l))))))
  (if dev (vl-catch-all-apply 'vla-put-ConfigName (list lo dev)))
  (vl-catch-all-apply 'vla-RefreshPlotDeviceInfo (list lo))
  (vl-catch-all-apply 'vla-put-PaperUnits (list lo acMillimeters))
  (setq media (vl-catch-all-apply 'sh:findmedia (list lo pw ph)) exact T)
  (if (/= (type media) 'STR) (setq media (vl-catch-all-apply 'sh:covermedia (list lo pw ph)) exact nil))
  (if (= (type media) 'STR)
    (progn
      (vla-put-CanonicalMediaName lo media)
      (vla-GetPaperSize lo 'w 'h)
      ;; landscape paper for a landscape sheet: no rotation
      (vl-catch-all-apply 'vla-put-PlotRotation (list lo (if (= (> w h) (> pw ph)) ac0degrees ac90degrees)))
      (if (not exact)
        (princ (strcat "\nThe plotter has no paper of " (rtos pw 2 0) " x " (rtos ph 2 0) " mm; using "
                       (vla-GetLocaleMediaName lo media) ". Add an exact custom paper size to trim it."))))
    (princ (strcat "\nThe plotter " (if dev dev "(none)") " has no paper of " (rtos pw 2 0) " x " (rtos ph 2 0)
                   " mm or larger. Add a custom paper size in the plotter configuration and choose it in Page Setup.")))
  (vl-catch-all-apply 'vla-put-PlotType (list lo acLayout))
  (vl-catch-all-apply 'vla-put-StandardScale (list lo ac1_1))
  (vl-catch-all-apply 'vla-put-CenterPlot (list lo :vlax-false))
  (vl-catch-all-apply 'vla-put-PlotOrigin
    (list lo (vlax-make-variant (vlax-safearray-fill (vlax-make-safearray vlax-vbDouble '(0 . 1)) '(0.0 0.0))))))

;; ---------- fit the current sheet ----------

;; sheet info from its frame: (type forced current-paper)
(defun sh:info (lay / f r bb)
  (if (setq f (car (sh:items lay '("frame"))))
    (progn (setq r (sh:roles f) bb (sh:bbox (list f)))
           (list (cadr r) (caddr r)
                 (if (and (cadddr r) (/= (cadddr r) ""))
                   (cadddr r)
                   ;; sheets made before the paper was kept: the frame is centered on the paper
                   (sh:papercode (+ (car (car bb)) (car (cadr bb))) (+ (cadr (car bb)) (cadr (cadr bb)))))
                 ;; title block layout: "column", "corner" or "" = by the paper
                 (if (nth 4 r) (nth 4 r) "")))
    (list "None" "" "" "")))

;; paper as a SHEETSIZE string: "A3L", "A3P" or "W,H"
(defun sh:papercode (pw ph / r)
  (foreach s *sh-papers*
    (cond (r)
          ((and (equal pw (cadr s) 1.0) (equal ph (caddr s) 1.0)) (setq r (strcat (car s) "L")))
          ((and (equal pw (caddr s) 1.0) (equal ph (cadr s) 1.0)) (setq r (strcat (car s) "P")))))
  (if r r (strcat (rtos pw 2 0) "," (rtos ph 2 0))))

(defun sh:inset-p (e) (member "inset" (sh:roles e)))
(defun sh:poly-p (e) (member "poly" (sh:roles e)))

;; ---------- insets: a small drawing inside the sheet, the other drawings cut around it ----------

(setq *sh-inset-gap* 2.0)   ; white space between an inset and the drawing around it (mm)
(setq *sh-snap* 6.0)        ; an inset this close to the frame or the title block sits flush against it (mm)

;; viewport rectangle on the paper: (x0 y0 x1 y1)
(defun sh:vprect (e / ed c w h)
  (setq ed (entget e) c (cdr (assoc 10 ed)) w (* 0.5 (cdr (assoc 40 ed))) h (* 0.5 (cdr (assoc 41 ed))))
  (list (- (car c) w) (- (cadr c) h) (+ (car c) w) (+ (cadr c) h)))

(defun sh:grow (r d) (list (- (nth 0 r) d) (- (nth 1 r) d) (+ (nth 2 r) d) (+ (nth 3 r) d)))

(defun sh:overlap (a b)
  (and (< (nth 0 a) (nth 2 b)) (< (nth 0 b) (nth 2 a)) (< (nth 1 a) (nth 3 b)) (< (nth 1 b) (nth 3 a))))

;; the part to cut out of rectangle R for inset box K: K carried past every side of R it touches,
;; or past the nearest side when it touches none (a viewport boundary can not have a hole)
(defun sh:cutbox (K R / tol x0 y0 x1 y1 d)
  (setq tol 0.5 x0 (nth 0 K) y0 (nth 1 K) x1 (nth 2 K) y1 (nth 3 K))
  (if (<= x0 (+ (nth 0 R) tol)) (setq x0 (- (nth 0 R) 1.0)))
  (if (<= y0 (+ (nth 1 R) tol)) (setq y0 (- (nth 1 R) 1.0)))
  (if (>= x1 (- (nth 2 R) tol)) (setq x1 (+ (nth 2 R) 1.0)))
  (if (>= y1 (- (nth 3 R) tol)) (setq y1 (+ (nth 3 R) 1.0)))
  (if (equal (list x0 y0 x1 y1) K 1e-9)
    (progn
      (setq d (list (- x0 (nth 0 R)) (- y0 (nth 1 R)) (- (nth 2 R) x1) (- (nth 3 R) y1)))
      (cond ((= (apply 'min d) (nth 0 d)) (setq x0 (- (nth 0 R) 1.0)))
            ((= (apply 'min d) (nth 1 d)) (setq y0 (- (nth 1 R) 1.0)))
            ((= (apply 'min d) (nth 2 d)) (setq x1 (+ (nth 2 R) 1.0)))
            (T (setq y1 (+ (nth 3 R) 1.0))))))
  (list x0 y0 x1 y1))

(defun sh:objarr (l)
  (vlax-make-variant (vlax-safearray-fill (vlax-make-safearray vlax-vbObject (cons 0 (1- (length l)))) l)))

(defun sh:region (r / pl reg)
  (setq pl (vlax-ename->vla-object (sh:rect (nth 0 r) (nth 1 r) (nth 2 r) (nth 3 r) (getvar "CTAB") "0")))
  (setq reg (car (sh:list (vla-AddRegion (vla-get-PaperSpace (sh:doc)) (sh:objarr (list pl))))))
  (vla-Delete pl)
  reg)

;; rectangle R minus the boxes Ks -> outline points, through regions
(defun sh:subtract (R Ks / ra rk objs segs)
  (setq ra (sh:region R))
  (foreach K Ks (setq rk (sh:region K)) (vla-Boolean ra acSubtraction rk))
  (setq objs (sh:list (vla-Explode ra)))
  (vla-Delete ra)
  (foreach o objs
    (if (= (vla-get-ObjectName o) "AcDbLine")
      (setq segs (cons (list (sh:list (vla-get-StartPoint o)) (sh:list (vla-get-EndPoint o))) segs)))
    (vla-Delete o))
  (sh:chain segs))

;; line segments -> one closed outline, without points in the middle of straight edges
(defun sh:chain (segs / pts s tip go r n a b c)
  (setq s (car segs) segs (cdr segs) pts (list (car s)) tip (cadr s) go T)
  (while go
    (setq pts (cons tip pts) go nil)
    (foreach q segs
      (if (not go)
        (cond ((equal (car q) tip 1e-6) (setq tip (cadr q) segs (vl-remove q segs) go T))
              ((equal (cadr q) tip 1e-6) (setq tip (car q) segs (vl-remove q segs) go T))))))
  (setq pts (reverse pts))
  (if (equal (car pts) (last pts) 1e-6) (setq pts (reverse (cdr (reverse pts)))))
  (setq n (length pts))
  (foreach i (sh:range n)
    (setq a (nth (rem (+ i n -1) n) pts) b (nth i pts) c (nth (rem (1+ i) n) pts))
    (if (not (equal 0.0 (- (* (- (car b) (car a)) (- (cadr c) (cadr a))) (* (- (cadr b) (cadr a)) (- (car c) (car a)))) 1e-6))
      (setq r (cons b r))))
  (reverse r))

(defun sh:range (n / r) (repeat n (setq r (cons (length r) r))) (reverse r))

;; clip viewport e with the outline pts (paper points); keeps its xdata. Returns the viewport.
(defun sh:setclip (e pts lay / xd old pl)
  (setq xd (sh:xd e) old (sh:clip e))
  (entmake (append (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(67 . 1) (cons 410 lay)
                         (cons 8 (sh:layer *sh-vp-layer*)) '(100 . "AcDbPolyline") (cons 90 (length pts)) '(70 . 1))
                   (mapcar '(lambda (q) (list 10 (car q) (cadr q))) pts)))
  (setq pl (entlast))
  (vla-put-DisplayLocked (vlax-ename->vla-object e) :vlax-false)
  (command "_.VPCLIP" e pl)
  (if (not (entget e)) (setq e (car (vl-remove-if-not '(lambda (v) (= (cdr (assoc 0 (entget v))) "VIEWPORT"))
                                                       (list (entlast))))))
  (if (and old (entget old) (not (equal old (sh:clip e)))) (entdel old))
  (sh:tag e xd)
  (vla-put-DisplayLocked (vlax-ename->vla-object e) :vlax-false)
  e)

;; remove a clip made by an inset (not a polyline the drawing was picked with)
(defun sh:unclip (e / xd old)
  (if (and (sh:clip e) (not (sh:poly-p e)))
    (progn
      (setq xd (sh:xd e) old (sh:clip e))
      (vla-put-DisplayLocked (vlax-ename->vla-object e) :vlax-false)
      (command "_.VPCLIP" e "_D")
      (if (and old (entget old)) (entdel old))
      (sh:tag e xd)))
  e)

;; center u of a box of half sizes hw hh, moved flush onto the sides of fr it is within tol of
(defun sh:snapc (u hw hh fr tol)
  (cond ((< (abs (- (car u) hw (nth 0 fr))) tol) (setq u (list (+ (nth 0 fr) hw) (cadr u))))
        ((< (abs (- (+ (car u) hw) (nth 2 fr))) tol) (setq u (list (- (nth 2 fr) hw) (cadr u)))))
  (cond ((< (abs (- (cadr u) hh (nth 1 fr))) tol) (setq u (list (car u) (+ (nth 1 fr) hh))))
        ((< (abs (- (+ (cadr u) hh) (nth 3 fr))) tol) (setq u (list (car u) (- (nth 3 fr) hh)))))
  u)

;; moving rectangle w x h on the sheet -> its center, or nil on Enter. snap: flush to the frame / title block.
(defun sh:place (w h snap prompt / fr dv go g c v u r hw hh tol)
  ;; corner layout (two divider lines): the drawing area reaches the right side of the frame under the title block
  (setq fr (sh:bbox (sh:items (getvar "CTAB") '("frame"))) dv (sh:items (getvar "CTAB") '("divider"))
        dv (if (null (cdr dv)) (sh:bbox dv))
        hw (+ (/ w 2.0) *sh-inset-gap*) hh (+ (/ h 2.0) *sh-inset-gap*) tol *sh-snap* go T)
  (if fr (setq fr (list (car (car fr)) (cadr (car fr)) (if dv (car (car dv)) (car (cadr fr))) (cadr (cadr fr)))))
  (princ prompt)
  (while go
    (setq g (grread T 15 0) c (car g) v (cadr g))
    (cond ((member c '(3 5))
           (setq u (list (car v) (cadr v)))
           (if (and snap fr) (setq u (sh:snapc u hw hh fr tol)))
           (redraw)
           (setq r (list (- (car u) (/ w 2.0)) (- (cadr u) (/ h 2.0)) (+ (car u) (/ w 2.0)) (+ (cadr u) (/ h 2.0))))
           (grvecs (list 3 (list (nth 0 r) (nth 1 r)) (list (nth 2 r) (nth 1 r)) 3 (list (nth 2 r) (nth 1 r)) (list (nth 2 r) (nth 3 r))
                         3 (list (nth 2 r) (nth 3 r)) (list (nth 0 r) (nth 3 r)) 3 (list (nth 0 r) (nth 3 r)) (list (nth 0 r) (nth 1 r))))
           (if (= c 3) (setq go nil r u)))
          ((and (= c 2) (member v '(13 32))) (setq go nil r nil))))
  (redraw)
  r)

;; the picked part of a drawing on the paper (from its xdata), around the viewport center: (min max)
(defun sh:core (e / x k c w h)
  (setq x (sh:reals e) k (sh:k (car x)) c (sh:vpcenter e) w (* 0.5 k (nth 3 x)) h (* 0.5 k (nth 4 x)))
  (list (list (- (car c) w) (- (cadr c) h) 0.0) (list (+ (car c) w) (+ (cadr c) h) 0.0)))

(defun sh:corebox (vps / bb mn mx)
  (foreach e vps
    (setq bb (sh:core e)
          mn (if mn (mapcar 'min mn (car bb)) (car bb))
          mx (if mx (mapcar 'max mx (cadr bb)) (cadr bb))))
  (if mn (list mn mx)))

;; size an unclipped viewport (paper mm) around its center and set its view again from the xdata
(defun sh:sizevp (e w h / vp x)
  (setq vp (vlax-ename->vla-object e) x (sh:reals e))
  (if (not (and (equal (vla-get-Width vp) w 1e-6) (equal (vla-get-Height vp) h 1e-6)))
    (progn
      (vla-put-DisplayLocked vp :vlax-false)
      (vla-put-Width vp w)
      (vla-put-Height vp h)
      (sh:setview vp (list (nth 1 x) (nth 2 x) 0.0) (nth 5 x) (sh:k (car x))))))

;; the viewports are not locked: read the scale and the view center they have now (zoomed or panned by hand)
;; into the xdata. A scale within 0.5% of a whole number is taken as that number.
(defun sh:sync (e / x cs s r v)
  (setq x (sh:reals e) cs (vla-get-CustomScale (vlax-ename->vla-object e)))
  (if (and x (> cs 0))
    (progn
      (setq s (/ (sh:upm) cs) r (fix (+ s 0.5)) v (sh:vpview e))
      ;; and zoomed to exactly that scale, so the printed scale is true
      (if (and (> r 0) (< (abs (- s r)) (* 0.005 s)))
        (progn (setq s (float r))
               (if (not (equal cs (sh:k r) 1e-9)) (sh:setview (vlax-ename->vla-object e) v (nth 5 x) (sh:k r)))))
      (if (not (and (equal s (car x) 1e-6) (equal (car v) (nth 1 x) 1e-6) (equal (cadr v) (nth 2 x) 1e-6)))
        (sh:tag e (append (mapcar '(lambda (q) (cons 1000 q)) (sh:roles e))
                          (list (cons 1040 s) (cons 1040 (car v)) (cons 1040 (cadr v))
                                (cons 1040 (nth 3 x)) (cons 1040 (nth 4 x)) (cons 1040 (nth 5 x))))))))
  e)

;; model point (WCS) at the center of a viewport
(defun sh:vpview (e / ed c t0 a)
  (setq ed (entget e) c (cdr (assoc 12 ed)) t0 (cdr (assoc 17 ed)) a (- (cdr (assoc 51 ed))))
  (list (+ (car t0) (- (* (cos a) (car c)) (* (sin a) (cadr c))))
        (+ (cadr t0) (+ (* (sin a) (car c)) (* (cos a) (cadr c))))
        0.0))

;; give an unclipped viewport the paper rectangle r. pick = T: the picked part in the middle,
;; otherwise the drawing stays where it is on the paper (only the boundary moves).
(defun sh:setrect (e r pick / vp ed x k c0 c1 w h v a d)
  (setq vp (vlax-ename->vla-object e) ed (entget e) x (sh:reals e) k (sh:k (car x))
        c0 (cdr (assoc 10 ed)) c1 (list (/ (+ (nth 0 r) (nth 2 r)) 2.0) (/ (+ (nth 1 r) (nth 3 r)) 2.0) 0.0)
        w (- (nth 2 r) (nth 0 r)) h (- (nth 3 r) (nth 1 r)))
  (if (not (and (equal c0 c1 1e-6) (equal (cdr (assoc 40 ed)) w 1e-6) (equal (cdr (assoc 41 ed)) h 1e-6)))
    (progn
      (setq a (- (cdr (assoc 51 ed))) d (list (/ (- (car c1) (car c0)) k) (/ (- (cadr c1) (cadr c0)) k)) v (sh:vpview e))
      (setq v (if pick
                (list (nth 1 x) (nth 2 x) 0.0)
                (list (+ (car v) (- (* (cos a) (car d)) (* (sin a) (cadr d))))
                      (+ (cadr v) (+ (* (sin a) (car d)) (* (cos a) (cadr d)))) 0.0)))
      (vla-put-DisplayLocked vp :vlax-false)
      (vla-put-Center vp (vlax-3d-point c1))
      (vla-put-Width vp w)
      (vla-put-Height vp h)
      (sh:setview vp v (nth 5 x) k))))

;; sides of r within tol of the area go onto it
(defun sh:snaprect (r area tol)
  (list (if (< (abs (- (nth 0 r) (nth 0 area))) tol) (nth 0 area) (nth 0 r))
        (if (< (abs (- (nth 1 r) (nth 1 area))) tol) (nth 1 area) (nth 1 r))
        (if (< (abs (- (nth 2 r) (nth 2 area))) tol) (nth 2 area) (nth 2 r))
        (if (< (abs (- (nth 3 r) (nth 3 area))) tol) (nth 3 area) (nth 3 r))))

(defun sh:clamp (r area)
  (list (max (nth 0 r) (nth 0 area)) (max (nth 1 r) (nth 1 area)) (min (nth 2 r) (nth 2 area)) (min (nth 3 r) (nth 3 area))))

;; ---------- sheets beside each other on one layout ----------
;; Each sheet ("" the first, "s:2".. added beside it) is fitted on its own. A sheet beside the first one has its
;; paper origin kept in the layout (ldata "s:N" = (x y)); it is fitted at the origin and moved back.

(defun sh:layobj (lay) (vla-Item (vla-get-Layouts (sh:doc)) lay))

(defun sh:sheetkeys (lay / old r)
  (setq old *sh-cur* *sh-cur* nil)
  (foreach e (sh:items lay '("vp")) (if (not (member (sh:sheetkey e) r)) (setq r (append r (list (sh:sheetkey e))))))
  (setq *sh-cur* old)
  (if (member "" r) (cons "" (vl-remove "" r)) r))

(defun sh:fit (typ forced)
  (sh:fitsheet (if *sh-cur* *sh-cur* "") typ forced))

(defun sh:fitsheet (key typ forced / lay o old)
  (setq lay (getvar "CTAB") old *sh-cur* *sh-cur* key
        o (if (/= key "") (vlax-ldata-get (sh:layobj lay) key)))
  (if o (sh:shiftsheet lay (- (car o)) (- (cadr o))))
  (sh:fit1 typ forced)
  (if o (sh:shiftsheet lay (car o) (cadr o)))
  (setq *sh-cur* old)
  (princ))

;; move every item of the current sheet (viewports with their clips)
(defun sh:shiftsheet (lay dx dy)
  (foreach e (sh:items lay nil)
    (if (= (cdr (assoc 0 (entget e))) "VIEWPORT") (sh:movevp e dx dy) (sh:move (list e) dx dy))))

(defun sh:nextsheet (lay / n old)
  (setq n 1 old *sh-cur* *sh-cur* nil)
  (foreach e (sh:items lay nil) (if (wcmatch (sh:sheetkey e) "s:*") (setq n (max n (atoi (substr (sh:sheetkey e) 3))))))
  (setq *sh-cur* old)
  (strcat "s:" (itoa (1+ n))))

;; papers of all the sheets on the layout: ((x0 y0 x1 y1) ...)
(defun sh:papers (lay / r o pc p old)
  (setq old *sh-cur*)
  (foreach k (sh:sheetkeys lay)
    (setq o (if (/= k "") (vlax-ldata-get (sh:layobj lay) k) '(0.0 0.0)) *sh-cur* k
          p (sh:forced (caddr (sh:info lay))) *sh-cur* old)
    (if (and o p) (setq r (cons (list (car o) (cadr o) (+ (car o) (cadr p)) (+ (cadr o) (caddr p))) r))))
  r)

;; a complete sheet (frame, paper, viewport, title block, sheet number) for pick, beside the sheets of the layout
(defun sh:sheetbeside (name pick typ / k wP hP blk u s paper o e)
  (setq k (sh:k (cadr pick)) wP (* k (cadr (car pick))) hP (* k (caddr (car pick)))
        blk (sh:blockfor typ) u (sh:nextsheet name) s (sh:stripsize blk)
        paper (sh:choose wP hP (car s) (cadr s))
        o (sh:placesheet name (cadr paper) (caddr paper)))
  (vlax-ldata-put (sh:layobj name) u o)
  (setq e (sh:addvp (car pick) (cadr pick) (list (+ (car o) (/ (cadr paper) 2.0)) (+ (cadr o) (/ (caddr paper) 2.0))) name))
  (sh:addrole e u)
  (if (and (/= blk "") (setq s (sh:addstrip blk name)))
    (progn (sh:addrole s u)
           (sh:move (list s) (car o) (cadr o))
           (sh:addloose s name u)))
  (sh:fitsheet u typ nil)
  u)

;; place a new paper w x h beside the papers already there: it follows the cursor and goes flush (gap) next to
;; them when close; Enter = on the left, bottoms aligned. -> paper origin (x y)
(defun sh:placesheet (lay w h / ps P gap go g c v u r tol cand d best bd)
  (setq ps (sh:papers lay) gap 20.0 tol 40.0 go T)
  (setq P (list (apply 'min (mapcar 'car ps)) (apply 'min (mapcar 'cadr ps))
                (apply 'max (mapcar 'caddr ps)) (apply 'max (mapcar 'cadddr ps))))
  (princ "\nClick where the new sheet goes (it sits beside the others when close), Enter = on the left: ")
  (while go
    (setq g (grread T 15 0) c (car g) v (cadr g))
    (cond ((member c '(3 5))
           (setq u (list (- (car v) (/ w 2.0)) (- (cadr v) (/ h 2.0))))
           ;; candidates: left / right (bottoms aligned), above / below (left sides aligned)
           (setq best nil bd tol)
           (foreach cand (list (list (- (nth 0 P) gap w) (nth 1 P)) (list (+ (nth 2 P) gap) (nth 1 P))
                               (list (nth 0 P) (+ (nth 3 P) gap)) (list (nth 0 P) (- (nth 1 P) gap h)))
             (setq d (distance u cand))
             (if (< d bd) (setq best cand bd d)))
           (if best (setq u best))
           (redraw)
           (grvecs (list 3 u (list (+ (car u) w) (cadr u)) 3 (list (+ (car u) w) (cadr u)) (list (+ (car u) w) (+ (cadr u) h))
                         3 (list (+ (car u) w) (+ (cadr u) h)) (list (car u) (+ (cadr u) h)) 3 (list (car u) (+ (cadr u) h)) u))
           (if (= c 3) (setq go nil r u)))
          ((and (= c 2) (member v '(13 32))) (setq go nil r (list (- (nth 0 P) gap w) (nth 1 P))))))
  (redraw)
  r)

(defun sh:fit1 (typ forced / lay info vps insets mains strip sbb sw shh bb ab gw gh paper pw ph m p colL acx acy dx dy f
                scs main a big x area carea R Ks wrap yb sbox)
  (setq lay (getvar "CTAB") info (sh:info lay))
  (if (null typ) (setq typ (car info)))
  (if (null forced) (setq forced (cadr info)))
  ;; scale and view as they are now; cuts made for insets are made again below
  (foreach e (sh:items lay '("vp")) (sh:sync e) (sh:unclip e))
  (setq vps (sh:items lay '("vp"))
        insets (vl-remove-if-not 'sh:inset-p vps)
        mains (vl-remove-if 'sh:inset-p vps))
  (cond
    ((null vps) (princ "\nNo drawing on this sheet. Use SHEET or SHEETADD."))
    ;; several drawings with their own title blocks on one paper
    ((cdr (sh:unitkeys mains)) (sh:fitmulti lay typ forced info))
    (T
      (setq strip (sh:migrate lay typ (sh:items lay '("strip"))))
      (if strip
        (setq sbb (sh:stripbb strip)
              sw (- (car (cadr sbb)) (car (car sbb)))
              shh (- (cadr (cadr sbb)) (cadr (car sbb))))
        (setq sw 0.0 shh 0.0))
      ;; the paper is chosen by the picked parts, not by the viewports (they may have grown to the frame);
      ;; a sheet with insets keeps its paper
      (setq bb (sh:corebox vps)
            gw (- (car (cadr bb)) (car (car bb)))
            gh (- (cadr (cadr bb)) (cadr (car bb))))
      (setq paper (cond ((sh:forced forced))
                        ((if insets (sh:forced (caddr info))))
                        ((sh:choose gw gh sw shh))))
      (setq pw (cadr paper) ph (caddr paper))
      (setq m (sh:margin (car paper) pw ph) p (sh:pad (car paper) pw ph))
      ;; title block layout: column (a line down the whole sheet) or corner (the drawing also fills the space under
      ;; the title block); by the paper unless chosen with SHEETWRAP
      (setq wrap (and strip
                      (cond ((= (cadddr info) "column") nil)
                            ((= (cadddr info) "corner") T)
                            (T (or (= (car paper) "ROLL") (>= (min pw ph) 400.0))))))
      ;; frame and divider
      (foreach e (sh:items lay '("frame" "divider" "insetframe")) (entdel e))
      (setq f (sh:rect m m (- pw m) (- ph m) lay (sh:layer *sh-frame-layer*)))
      (sh:tag f (list (cons 1000 "frame") (cons 1000 typ) (cons 1000 (if forced forced ""))
                      (cons 1000 (sh:papercode pw ph)) (cons 1000 (cadddr info))))
      (setq colL (- pw m (sh:col sw)) carea (list m m colL (- ph m)))
      (if wrap
        (setq yb (- ph m (* 2.0 *sh-inset*) shh)
              sbox (list colL yb (- pw m) (- ph m))
              area (list m m (- pw m) (- ph m)))
        (setq sbox nil area carea))
      (if strip
        (progn
          (if wrap
            (progn
              (sh:tag (sh:line colL yb colL (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider")))
              (sh:tag (sh:line colL yb (- pw m) yb lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider"))))
            (sh:tag (sh:line colL m colL (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider"))))
          (sh:move strip (- (- pw m *sh-inset*) (car (cadr sbb))) (- (- ph m *sh-inset*) (cadr (cadr sbb))))))
      (setq acx (/ (+ m colL) 2.0) acy (/ ph 2.0))
      (cond
        ;; one drawing (with or without insets): it fills the frame up to the title block, the picked part in the middle
        ((and mains (null (cdr mains)) (not (sh:poly-p (car mains))))
         ;; the picked part in the middle of the space beside the title block; in corner layout the viewport then
         ;; grows under the title block too (cut around it below). Only for a new or rescaled viewport: one that
         ;; already fills the frame keeps its view (it may have been panned by hand).
         (if (not (equal (sh:vprect (car mains)) area 0.01))
           (progn
             (if (null insets)
               (progn (setq bb (sh:corebox mains))
                      (sh:movevp (car mains) (- acx (/ (+ (car (car bb)) (car (cadr bb))) 2.0))
                                             (- acy (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))))
             (sh:setrect (car mains) carea T)))
         (sh:setrect (car mains) area nil))
        ;; insets placed by hand: nothing moves
        (insets nil)
        ;; several drawings: keep their sizes (also when stretched by hand) and center them; edges close to the
        ;; frame or the title block go onto it
        (T
         (setq ab (sh:bbox vps))
         (if (and (<= (- (car (cadr ab)) (car (car ab))) (+ (- colL m) 0.5))
                  (<= (- (cadr (cadr ab)) (cadr (car ab))) (+ (- ph m m) 0.5)))
           (setq bb ab))
         (setq dx (- acx (/ (+ (car (car bb)) (car (cadr bb))) 2.0))
               dy (- acy (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))
         (foreach e vps (sh:movevp e dx dy))
         (foreach e (sh:items lay '("vp"))
           (if (not (sh:clip e)) (sh:setrect e (sh:snaprect (sh:vprect e) area 5.0) nil)))))
      ;; insets: a thin frame around each, the other drawings cut around them
      (foreach e insets
        (setq x (sh:clamp (sh:grow (sh:vprect e) *sh-inset-gap*) area))
        (sh:tag (sh:rect (nth 0 x) (nth 1 x) (nth 2 x) (nth 3 x) lay (sh:layer *sh-frame-layer*))
                (list (cons 1000 "insetframe"))))
      (if (or insets sbox)
        (foreach e (vl-remove-if 'sh:poly-p (vl-remove-if 'sh:inset-p (sh:items lay '("vp"))))
          (setq R (sh:vprect e) Ks nil)
          (foreach i insets
            (setq x (sh:grow (sh:vprect i) *sh-inset-gap*))
            (if (sh:overlap x R) (setq Ks (cons (sh:cutbox x R) Ks))))
          (if (and sbox (sh:overlap sbox R)) (setq Ks (cons (sh:cutbox sbox R) Ks)))
          (if Ks (sh:setclip e (sh:subtract R Ks) lay))))
      (setq vps (sh:items lay '("vp")))
      (if (not (sh:fits (car paper) pw ph gw gh sw shh))
        (princ (strcat "\nThe drawings do not fit on " (sh:papername paper) ". Use SHEETSIZE Auto or a smaller scale.")))
      (if (and (= (car paper) "ROLL") (or (> (min pw ph) *sh-roll-max-short*) (> (max pw ph) *sh-roll-max-long*)))
        (princ (strcat "\nRoll sheet " (sh:papername paper) " is larger than 900 x 5000 mm. Choose a smaller scale.")))
      ;; title block texts: paper size and scale of the largest drawing (all scales if they differ)
      (setq big 0.0)
      (foreach e vps
        (setq a (* (cdr (assoc 40 (entget e))) (cdr (assoc 41 (entget e)))))
        (if (not (member (fix (car (sh:reals e))) scs)) (setq scs (append scs (list (fix (car (sh:reals e)))))))
        (if (> a big) (setq big a main (fix (car (sh:reals e))))))
      (sh:settext lay "size" (sh:papername paper))
      (sh:settext lay "scale"
        (if (cdr scs)
          (apply 'strcat (cons (strcat "1:" (itoa main))
                               (mapcar '(lambda (s) (strcat ", 1:" (itoa s))) (vl-remove main scs))))
          (strcat "1:" (itoa main))))
      (sh:finish lay paper main)))
  (princ))

;; zoom to the sheets' papers (not to the extents: something far away on the layout would zoom far out)
(defun sh:zoompapers (lay / ps d)
  (if (setq ps (sh:papers lay))
    (progn
      (setq d 10.0)
      (vla-ZoomWindow (vlax-get-acad-object)
        (vlax-3d-point (- (apply 'min (mapcar 'car ps)) d) (- (apply 'min (mapcar 'cadr ps)) d) 0.0)
        (vlax-3d-point (+ (apply 'max (mapcar 'caddr ps)) d) (+ (apply 'max (mapcar 'cadddr ps)) d) 0.0)))
    (command "_.ZOOM" "_E")))

;; plot settings, message and layout name of a fitted sheet
(defun sh:finish (lay paper main / pw ph)
  (setq pw (cadr paper) ph (caddr paper))
  ;; the layout's page setup belongs to the first sheet
  (if (member *sh-cur* '(nil "")) (sh:plot pw ph))
  (sh:zoompapers lay)
  (setq *sh-paper* (sh:papername paper) *sh-main-scale* main)
  ;; shown by sh:end, after the command echo
  (setq *sh-msg* (strcat "\nSheet " lay ": " (sh:papername paper)
                         (if (= (car paper) "ROLL") " mm (roll)" (if (> pw ph) " landscape" " portrait"))
                         ", 1:" (itoa main)))
  ;; a layout named by paper and scale ("A3 1-250") follows the sheet when the scale or the paper changes
  (if (and (member *sh-cur* '(nil "")) (wcmatch lay "A# 1-#*,#*x#* 1-#*")
           (not (wcmatch lay (strcat (sh:papername paper) " 1-" (itoa main) ","
                                     (sh:papername paper) " 1-" (itoa main) " (#*)"))))
    (setq *sh-last-layout* (sh:rename lay (sh:autoname (sh:papername paper) main)))))

;; ---------- several drawings with their own title blocks (units) on one paper ----------

;; unit of a sheet item: "" for the first drawing, "u:2", "u:3".. for drawings added with their own title block
(defun sh:unit (e / r)
  (setq r (car (vl-remove-if-not '(lambda (q) (wcmatch q "u:*")) (sh:roles e))))
  (if r r ""))

(defun sh:unitkeys (ents / r)
  (foreach e ents (if (not (member (sh:unit e) r)) (setq r (append r (list (sh:unit e))))))
  r)

(defun sh:nextunit (lay / n)
  (setq n 1)
  (foreach e (append (sh:items lay '("vp")) (sh:items lay '("strip")))
    (if (wcmatch (sh:unit e) "u:*") (setq n (max n (atoi (substr (sh:unit e) 3))))))
  (strcat "u:" (itoa (1+ n))))

;; each unit: its drawing fills its own part of the paper beside its own title block; the units side by side
;; (in the order they are on the sheet), a line between them, one frame around all.
(defun sh:fitmulti (lay typ forced info / vps insets strips units us paper pw ph m W H extra x x0 x1 colL wrap yb
                    carea area sbox st sbb sw shh mains bb cx f R Ks i main big a scs rec allscale)
  (setq vps (sh:items lay '("vp"))
        insets (vl-remove-if-not 'sh:inset-p vps)
        strips (sh:items lay '("strip"))
        units (sh:unitkeys (vl-remove-if 'sh:inset-p vps)))
  ;; the first drawing's title block may still be exploded (older sheets)
  (setq st (sh:migrate lay typ (vl-remove-if-not '(lambda (s) (= (sh:unit s) "")) strips))
        strips (append st (vl-remove-if '(lambda (s) (= (sh:unit s) "")) strips)))
  ;; per unit: (key mains strip sbb sw shh corebox needed-width order-x)
  (foreach u units
    (setq mains (vl-remove-if '(lambda (v) (or (sh:inset-p v) (/= (sh:unit v) u))) vps)
          st (vl-remove-if '(lambda (s) (/= (sh:unit s) u)) strips)
          sbb (if st (sh:stripbb st))
          sw (if sbb (- (car (cadr sbb)) (car (car sbb))) 0.0)
          shh (if sbb (- (cadr (cadr sbb)) (cadr (car sbb))) 0.0)
          bb (sh:corebox mains)
          cx (/ (+ (car (car (sh:bbox mains))) (car (cadr (sh:bbox mains)))) 2.0))
    (setq us (cons (list u mains st sbb sw shh bb (+ (- (car (cadr bb)) (car (car bb))) (sh:col sw)) cx) us)))
  (setq us (vl-sort us '(lambda (a b) (< (nth 8 a) (nth 8 b))))
        W (apply '+ (mapcar '(lambda (q) (nth 7 q)) us))
        H (apply 'max (mapcar '(lambda (q) (max (- (cadr (cadr (nth 6 q))) (cadr (car (nth 6 q)))) (+ (nth 5 q) (* 2 *sh-inset*)))) us)))
  ;; the paper stays (the units share it); the first drawing gets the width the others leave
  (setq paper (cond ((sh:forced forced))
                    ((sh:forced (caddr info)))
                    ((sh:choosew W H))))
  (setq pw (cadr paper) ph (caddr paper) m (sh:margin (car paper) pw ph)
        extra (- pw m m W))
  (if (< extra 0.0)
    (princ (strcat "\nThe drawings need " (rtos (+ W m m) 2 0) " mm, the paper is " (rtos pw 2 0)
                   " mm wide: the first drawing is narrower than its picked part. Use a smaller scale for the added one.")))
  (setq us (mapcar '(lambda (q) (if (= (car q) "")
                                  (list (nth 0 q) (nth 1 q) (nth 2 q) (nth 3 q) (nth 4 q) (nth 5 q) (nth 6 q)
                                        (+ (nth 7 q) extra) (nth 8 q))
                                  q))
                   us))
  (setq wrap (cond ((= (cadddr info) "column") nil)
                   ((= (cadddr info) "corner") T)
                   (T (or (= (car paper) "ROLL") (>= (min pw ph) 400.0)))))
  (foreach e (sh:items lay '("frame" "divider" "insetframe")) (entdel e))
  (setq f (sh:rect m m (- pw m) (- ph m) lay (sh:layer *sh-frame-layer*)))
  (sh:tag f (list (cons 1000 "frame") (cons 1000 typ) (cons 1000 (if forced forced ""))
                  (cons 1000 (sh:papercode pw ph)) (cons 1000 (cadddr info))))
  (setq x m i 0 big 0.0)
  (foreach q us
    (setq i (1+ i) mains (nth 1 q) st (nth 2 q) sbb (nth 3 q) sw (nth 4 q) shh (nth 5 q)
          x0 x x1 (if (= i (length us)) (- pw m) (+ x0 (nth 7 q))) colL (- x1 (sh:col sw)) x x1)
    ;; line between units
    (if (< i (length us))
      (sh:tag (sh:line x1 m x1 (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider"))))
    (setq carea (list x0 m colL (- ph m)) area carea sbox nil)
    (if st
      (progn
        (if (and wrap (> (- (- ph m m) (+ shh (* 2.0 *sh-inset*))) 20.0))
          (progn
            (setq yb (- ph m (* 2.0 *sh-inset*) shh) sbox (list colL yb x1 (- ph m)) area (list x0 m x1 (- ph m)))
            (sh:tag (sh:line colL yb colL (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider")))
            (sh:tag (sh:line colL yb x1 yb lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider"))))
          (sh:tag (sh:line colL m colL (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider"))))
        (sh:move st (- (- x1 *sh-inset*) (car (cadr sbb))) (- (- ph m *sh-inset*) (cadr (cadr sbb))))))
    ;; the unit's drawing: one fills its area (picked part in the middle), several are centered in it
    (if (and mains (null (cdr mains)) (not (sh:poly-p (car mains))))
      (progn
        (if (not (equal (sh:vprect (car mains)) area 0.01))
          (progn
            (setq bb (sh:corebox mains))
            (sh:movevp (car mains) (- (/ (+ x0 colL) 2.0) (/ (+ (car (car bb)) (car (cadr bb))) 2.0))
                                   (- (/ ph 2.0) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))
            (sh:setrect (car mains) carea T)))
        (sh:setrect (car mains) area nil))
      (progn
        (setq bb (sh:bbox mains))
        (foreach e mains (sh:movevp e (- (/ (+ x0 colL) 2.0) (/ (+ (car (car bb)) (car (cadr bb))) 2.0))
                                      (- (/ ph 2.0) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0))))))
    ;; insets inside this unit, and the cut around them and the title block corner
    (setq rec nil)
    (foreach e insets
      (setq R (sh:vprect e))
      (if (< x0 (/ (+ (nth 0 R) (nth 2 R)) 2.0) x1)
        (progn (setq rec (cons e rec) R (sh:clamp (sh:grow R *sh-inset-gap*) area))
               (sh:tag (sh:rect (nth 0 R) (nth 1 R) (nth 2 R) (nth 3 R) lay (sh:layer *sh-frame-layer*))
                       (list (cons 1000 "insetframe"))))))
    (foreach e (vl-remove-if '(lambda (v) (or (sh:poly-p v) (sh:inset-p v) (/= (sh:unit v) (car q)))) (sh:items lay '("vp")))
      (setq R (sh:vprect e) Ks nil)
      (foreach v rec
        (setq a (sh:grow (sh:vprect v) *sh-inset-gap*))
        (if (sh:overlap a R) (setq Ks (cons (sh:cutbox a R) Ks))))
      (if (and sbox (sh:overlap sbox R)) (setq Ks (cons (sh:cutbox sbox R) Ks)))
      (if Ks (sh:setclip e (sh:subtract R Ks) lay)))
    ;; this unit's title block: its own scale(s), the paper size
    (setq scs nil main nil a 0.0)
    (foreach e (append (vl-remove-if '(lambda (v) (/= (sh:unit v) (car q))) (sh:items lay '("vp"))) rec)
      (if (not (member (fix (car (sh:reals e))) scs)) (setq scs (append scs (list (fix (car (sh:reals e)))))))
      (if (> (* (cdr (assoc 40 (entget e))) (cdr (assoc 41 (entget e)))) a)
        (setq a (* (cdr (assoc 40 (entget e))) (cdr (assoc 41 (entget e)))) main (fix (car (sh:reals e))))))
    (if (> a big) (setq big a allscale main))
    (foreach s st
      (if (= (cdr (assoc 0 (entget s))) "INSERT")
        (progn (sh:attset s "SIZE" (sh:papername paper))
               (sh:attset s "SCALE" (apply 'strcat (cons (strcat "1:" (itoa main))
                                                         (mapcar '(lambda (s) (strcat ", 1:" (itoa s))) (vl-remove main scs)))))))))
  (if (and (= (car paper) "ROLL") (or (> (min pw ph) *sh-roll-max-short*) (> (max pw ph) *sh-roll-max-long*)))
    (princ (strcat "\nRoll sheet " (sh:papername paper) " is larger than 900 x 5000 mm. Choose a smaller scale.")))
  (sh:finish lay paper allscale))

;; smallest paper whose drawing area (inside the frame) holds W x H, 3% allowed over; else a roll
(defun sh:choosew (W H / r m)
  (foreach s *sh-papers*
    (if (not r)
      (foreach o (list (list (cadr s) (caddr s)) (list (caddr s) (cadr s)))
        (setq m (sh:margin (car s) (car o) (cadr o)))
        (if (and (not r) (<= W (* 1.03 (- (car o) m m))) (<= H (* 1.03 (- (cadr o) m m))))
          (setq r (list (car s) (car o) (cadr o)))))))
  (if r r
    (progn (setq m (sh:margin "ROLL" 0 0))
           (list "ROLL" (sh:up10 (max *sh-roll-min* (+ W m m))) (sh:up10 (max *sh-roll-min* (+ H m m)))))))

;; ---------- viewports ----------

(defun sh:setview (vp cW ang k / doc names old)
  (setq doc (sh:doc)
        names '("ANGBASE" "ANGDIR" "AUNITS" "OSMODE")
        old (mapcar 'getvar names))
  (mapcar 'setvar names '(0.0 0 0 0))
  (vla-put-DisplayLocked vp :vlax-false)
  (vla-put-MSpace doc :vlax-true)
  (vla-put-ActivePViewport doc vp)
  (command "_.UCS" "_W")
  (if (not (equal ang 0.0 1e-9)) (command "_.UCS" "_Z" (rtos (* ang (/ 180.0 pi)) 2 10)))
  (command "_.PLAN" "_C")
  (command "_.ZOOM" "_C" (trans cW 0 1) (strcat (rtos k 2 12) "XP"))
  (vla-put-CustomScale vp k)
  (vla-put-MSpace doc :vlax-false)
  (vla-put-DisplayLocked vp :vlax-false)
  (mapcar 'setvar names old))

;; points of a lightweight polyline: ((x y bulge) ...)
(defun sh:plpts (e / r pt)
  (foreach d (entget e)
    (cond ((= (car d) 10) (if pt (setq r (cons pt r))) (setq pt (list (cadr d) (caddr d) 0.0)))
          ((and (= (car d) 42) pt) (setq pt (list (car pt) (cadr pt) (cdr d))))))
  (if pt (setq r (cons pt r)))
  (reverse r))

;; sel = (cW wU hU ang pline) ; pc = paper center
(defun sh:addvp (sel scale pc lay / k cW ang vp e c s pts pl)
  (setq k (sh:k scale) cW (car sel) ang (cadddr sel))
  (setq vp (vla-AddPViewport (vla-get-PaperSpace (sh:doc)) (vlax-3d-point (car pc) (cadr pc) 0)
                             (* k (cadr sel)) (* k (caddr sel))))
  (vla-put-Layer vp (sh:layer *sh-vp-layer*))
  (vla-put-ViewportOn vp :vlax-true)
  (sh:setview vp cW ang k)
  (setq e (vlax-vla-object->ename vp))
  (if (nth 4 sel)
    (progn
      (setq c (cos (- ang)) s (sin (- ang)))
      (setq pts (mapcar '(lambda (v / x y)
                           (setq x (- (car v) (car cW)) y (- (cadr v) (cadr cW)))
                           (list (+ (car pc) (* k (- (* c x) (* s y))))
                                 (+ (cadr pc) (* k (+ (* s x) (* c y))))
                                 (caddr v)))
                        (sh:plpts (nth 4 sel))))
      (entmake (append (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(67 . 1) (cons 410 lay)
                             (cons 8 (sh:layer *sh-vp-layer*)) '(100 . "AcDbPolyline")
                             (cons 90 (length pts)) '(70 . 1))
                       (apply 'append (mapcar '(lambda (q) (list (list 10 (car q) (cadr q)) (cons 42 (caddr q)))) pts))))
      (setq pl (entlast))
      (command "_.VPCLIP" e pl)
      (if (not (entget e)) (setq e (entlast)))))
  (sh:tag e (append (list (cons 1000 "vp")) (if (nth 4 sel) (list (cons 1000 "poly")))
                    (list (cons 1040 (float scale)) (cons 1040 (car cW)) (cons 1040 (cadr cW))
                          (cons 1040 (cadr sel)) (cons 1040 (caddr sel)) (cons 1040 ang))))
  e)

;; add a role (e.g. "inset") to a tagged entity, keeping the rest of its xdata
(defun sh:addrole (e role / xd)
  (setq xd (sh:xd e))
  (sh:tag e (cons (car xd) (cons (cons 1000 role) (cdr xd)))))

;; ---------- picking in model space ----------

(defun sh:ucsang () (angle '(0 0 0) (getvar "UCSXDIR")))

;; align the UCS (and the model view) to a line picked by two points
(defun sh:rotate (/ p1 p2 a names old)
  (if (and (setq p1 (getpoint "\nFirst point of a line that should be horizontal: "))
           (setq p2 (getpoint p1 "\nSecond point: ")))
    (progn
      (setq a (angle (trans p1 1 0) (trans p2 1 0)))
      (setq names '("ANGBASE" "ANGDIR" "AUNITS") old (mapcar 'getvar names))
      (mapcar 'setvar names '(0.0 0 0))
      ;; the model's UCS and view as they were, put back when the drawing has been picked
      (if (not *sh-saved*)
        (progn
          (if (tblsearch "UCS" "ORISHEET_TMP") (command "_.UCS" "_D" "ORISHEET_TMP"))
          (command "_.UCS" "_S" "ORISHEET_TMP")
          (if (tblsearch "VIEW" "ORISHEET_TMP") (command "_.-VIEW" "_D" "ORISHEET_TMP"))
          (command "_.-VIEW" "_S" "ORISHEET_TMP")
          (setq *sh-saved* (if (= (getvar "WORLDUCS") 1) "world" "named"))))
      (command "_.UCS" "_W")
      (command "_.UCS" "_Z" (rtos (* a (/ 180.0 pi)) 2 10))
      (command "_.PLAN" "_C")
      (mapcar 'setvar names old))))

(defun sh:nextscale (sc dir / l r)
  (setq l (if (> dir 0) *sh-scales* (reverse *sh-scales*)))
  (foreach s l (if (and (not r) (if (> dir 0) (> s sc) (< s sc))) (setq r s)))
  (if r r sc))

;; moving frame of a paper's drawing area -> (sel scale forced) or 'rotate
(defun sh:jig (typ / blk ss sw shh scale paper orient buf u go res g c v pw ph pp m p uw uh k colL acx
               ux uy px py sx sy pts)
  (setq blk (sh:blockfor typ) ss (sh:stripsize blk) sw (car ss) shh (cadr ss)
        scale *sh-last-scale* paper *sh-last-paper* orient *sh-last-orient* buf "" go T u (getvar "VIEWCTR"))
  (while go
    (setq pp (cdr (assoc paper *sh-papers*)))
    (if (= orient "L") (setq pw (car pp) ph (cadr pp)) (setq pw (cadr pp) ph (car pp)))
    (setq m (sh:margin paper pw ph) p (sh:pad paper pw ph) k (sh:k scale)
          uw (car (sh:usable paper pw ph sw shh)) uh (cadr (sh:usable paper pw ph sw shh))
          colL (- pw m (sh:col sw)) acx (/ (+ m p (- colL p)) 2.0))
    (redraw)
    ;; drawing area (green), sheet (grey), title block (red); model points around the cursor u (UCS)
    (setq ux (/ uw 2.0 k) uy (/ uh 2.0 k))
    (grvecs (list 3 (sh:off u (- ux) (- uy)) (sh:off u ux (- uy))
                  3 (sh:off u ux (- uy)) (sh:off u ux uy)
                  3 (sh:off u ux uy) (sh:off u (- ux) uy)
                  3 (sh:off u (- ux) uy) (sh:off u (- ux) (- uy))))
    (setq px (/ (- 0 acx) k) py (/ (- (/ ph 2.0)) k) sx (/ (- pw acx) k) sy (/ (/ ph 2.0) k))
    (grvecs (list 8 (sh:off u px py) (sh:off u sx py) 8 (sh:off u sx py) (sh:off u sx sy)
                  8 (sh:off u sx sy) (sh:off u px sy) 8 (sh:off u px sy) (sh:off u px py)))
    (if (> sw 0)
      (progn (setq px (/ (- pw m *sh-inset* sw acx) k) sx (/ (- pw m *sh-inset* acx) k)
                   sy (/ (- (/ ph 2.0) m *sh-inset*) k) py (- sy (/ shh k)))
             (grvecs (list 1 (sh:off u px py) (sh:off u sx py) 1 (sh:off u sx py) (sh:off u sx sy)
                           1 (sh:off u sx sy) (sh:off u px sy) 1 (sh:off u px sy) (sh:off u px py)))))
    (grtext -1 (strcat "1:" (itoa scale) "  " paper (if (= orient "L") " landscape" " portrait")
                       "   type scale+Enter  +/-  S size  O orient  R align" (if (/= buf "") (strcat "   1:" buf) "")))
    (princ (strcat "\r1:" (itoa scale) " " paper orient "  [scale+Enter, +/-, S size, O orient, R align, click = place] "
                   buf "        "))
    (setq g (grread T 15 0) c (car g) v (cadr g))
    (cond ((= c 5) (setq u v))
          ((= c 3) (setq u v go nil res (list (list u (/ uw k) (/ uh k) (sh:ucsang) nil) scale (strcat paper orient))))
          ((= c 2)
           (cond ((and (>= v 48) (<= v 57)) (setq buf (strcat buf (chr v))))
                 ((= v 8) (if (> (strlen buf) 0) (setq buf (substr buf 1 (1- (strlen buf))))))
                 ((member v '(13 32)) (if (and (/= buf "") (> (atoi buf) 0)) (setq scale (atoi buf))) (setq buf ""))
                 ((member v '(43 61)) (setq scale (sh:nextscale scale 1)))
                 ((= v 45) (setq scale (sh:nextscale scale -1)))
                 ((member v '(83 115))
                  (setq paper (car (nth (rem (1+ (vl-position (assoc paper *sh-papers*) *sh-papers*)) (length *sh-papers*))
                                        *sh-papers*))))
                 ((member v '(79 111)) (setq orient (if (= orient "L") "P" "L")))
                 ((member v '(82 114)) (setq go nil res 'rotate))))))
  (redraw)
  (grtext -1 "")
  (if (listp res) (setq *sh-last-scale* (cadr res) *sh-last-paper* paper *sh-last-orient* orient))
  res)

(defun sh:off (u dx dy) (list (+ (car u) dx) (+ (cadr u) dy)))

;; pick the drawing -> (sel scale forced) ; sel = (cW wU hU ang pline), cW = center in WCS
(defun sh:pick (typ scale allowframe / p1 p2 r e pts mn mx)
  ;; window corners are free points: running object snaps off while picking (back in sh:end / sh:error)
  (setvar "OSMODE" (logior *sh-oldosmode* 16384))
  (while (not r)
    (initget (if allowframe "Polyline Frame Rotate" "Polyline Rotate"))
    (setq p1 (getpoint (if allowframe "\nFirst corner of the drawing or [Polyline/Frame/Rotate]: "
                                      "\nFirst corner of the drawing or [Polyline/Rotate]: ")))
    (cond ((null p1) (setq r 'cancel))
          ((= p1 "Rotate") (sh:rotate))
          ((= p1 "Frame")
           (setq *sh-last-scale* scale)
           (setq r (sh:jig typ))
           (if (= r 'rotate) (progn (sh:rotate) (setq r nil))))
          ((= p1 "Polyline")
           (if (and (setq e (car (entsel "\nSelect a closed polyline around the drawing: ")))
                    (= (cdr (assoc 0 (entget e))) "LWPOLYLINE"))
             (progn
               (setq pts (mapcar '(lambda (q) (trans (list (car q) (cadr q) 0.0) 0 1)) (sh:plpts e)))
               (setq mn (list (apply 'min (mapcar 'car pts)) (apply 'min (mapcar 'cadr pts)))
                     mx (list (apply 'max (mapcar 'car pts)) (apply 'max (mapcar 'cadr pts))))
               (setq r (list (list (list (/ (+ (car mn) (car mx)) 2.0) (/ (+ (cadr mn) (cadr mx)) 2.0) 0.0)
                                   (- (car mx) (car mn)) (- (cadr mx) (cadr mn)) (sh:ucsang) e)
                             scale "")))
             (princ "\nThat is not a polyline.")))
          ((listp p1)
           (if (setq p2 (getcorner p1 "\nOther corner: "))
             (setq r (list (list (list (/ (+ (car p1) (car p2)) 2.0) (/ (+ (cadr p1) (cadr p2)) 2.0) 0.0)
                                 (abs (- (car p2) (car p1))) (abs (- (cadr p2) (cadr p1))) (sh:ucsang) nil)
                           scale ""))))))
  (setvar "OSMODE" *sh-oldosmode*)
  ;; center to WCS now, while the model UCS is current (the layout has its own UCS)
  (if (listp r) (setq r (cons (cons (trans (car (car r)) 1 0) (cdr (car r))) (cdr r))))
  (sh:restoremodel)
  (if (= r 'cancel) nil r))

;; Rotate turned the model's UCS and view: back as they were (the sheet keeps the turn)
(defun sh:restoremodel (/ names old)
  (if (and *sh-saved* (= (getvar "TILEMODE") 1))
    (progn
      (setq names '("ANGBASE" "ANGDIR" "AUNITS") old (mapcar 'getvar names))
      (mapcar 'setvar names '(0.0 0 0))
      (if (= *sh-saved* "world") (command "_.UCS" "_W") (command "_.UCS" "_R" "ORISHEET_TMP"))
      (command "_.-VIEW" "_R" "ORISHEET_TMP")
      (command "_.UCS" "_D" "ORISHEET_TMP")
      (command "_.-VIEW" "_D" "ORISHEET_TMP")
      (mapcar 'setvar names old)))
  (setq *sh-saved* nil))

;; ---------- commands ----------

(defun sh:begin ()
  (setq *sh-olderr* *error* *sh-oldecho* (getvar "CMDECHO") *sh-oldosmode* (getvar "OSMODE"))
  (setq *error* sh:error *sh-msg* nil *sh-paper* nil *sh-cur* nil *sh-saved* nil)
  (setvar "CMDECHO" 0)
  (vla-StartUndoMark (sh:doc)))

(defun sh:end ()
  (vla-EndUndoMark (sh:doc))
  (setvar "CMDECHO" *sh-oldecho*)
  (setvar "OSMODE" *sh-oldosmode*)
  (setq *error* *sh-olderr* *sh-cur* nil)
  (if *sh-msg* (prompt *sh-msg*))
  (setq *sh-msg* nil)
  (princ))

(defun sh:error (msg)
  (redraw)
  (grtext -1 "")
  (if (not (wcmatch (strcase msg) "*CANCEL*,*QUIT*,*EXIT*,*BREAK*")) (princ (strcat "\nError: " msg)))
  (vl-catch-all-apply 'vla-EndUndoMark (list (sh:doc)))
  (if *sh-oldecho* (setvar "CMDECHO" *sh-oldecho*))
  (if *sh-oldosmode* (setvar "OSMODE" *sh-oldosmode*))
  ;; cancelled after Rotate: the model's UCS and view back too
  (vl-catch-all-apply 'sh:restoremodel nil)
  (setq *error* *sh-olderr* *sh-cur* nil)
  (princ))

(defun sh:newname (/ i n)
  (setq i 1)
  (while (member (strcase (setq n (strcat "Sheet" (itoa i)))) (mapcar 'strcase (layoutlist))) (setq i (1+ i)))
  n)

(defun sh:gotomodel () (if (/= (getvar "TILEMODE") 1) (setvar "TILEMODE" 1)))

(defun sh:askscale (/ s)
  (setq s (getint (strcat "\nScale 1: <" (itoa *sh-last-scale*) ">: ")))
  (if (and s (> s 0)) (setq *sh-last-scale* s))
  *sh-last-scale*)

(defun c:SHEET (/ typ scale pick name doc lay ss i e blk auto s n k)
  (sh:begin)
  (sh:gotomodel)
  (initget "Construction Tabaa None")
  (setq typ (getkword (strcat "\nTitle block [Construction/Tabaa/None] <" *sh-last-type* ">: ")))
  (if typ (setq *sh-last-type* typ) (setq typ *sh-last-type*))
  (setq scale (sh:askscale))
  (if (and (setq pick (sh:pick typ scale T))
           (progn (sh:setunits (car (car pick)))
                  (setq pick (sh:checkpick pick))))
    (progn
      (setq name (getstring T "\nLayout name <paper and scale, e.g. A3 1-250>: "))
      (if (= name "") (setq name (sh:newname) auto T))
      (if (member (strcase name) (mapcar 'strcase (layoutlist)))
        (princ (strcat "\nLayout " name " already exists. Use SHEETADD to add to it."))
        (progn
          (setq doc (sh:doc))
          (vla-Add (vla-get-Layouts doc) name)
          (setvar "CTAB" name)
          (command "_.PSPACE")
          ;; remove the viewport the program may create in a new layout
          (if (setq ss (ssget "_X" (list '(0 . "VIEWPORT") (cons 410 name))))
            (repeat (setq i (sslength ss))
              (setq e (ssname ss (setq i (1- i))))
              (if (/= (cdr (assoc 69 (entget e))) 1) (entdel e))))
          (setq blk (sh:blockfor typ))
          (if (and (/= blk "") (setq s (sh:addstrip blk name))) (sh:addloose s name ""))
          (sh:addvp (car pick) (cadr pick) '(0.0 0.0) name)
          (sh:fit typ (caddr pick))
          (if (and auto *sh-paper*) (setq name (sh:rename name (sh:autoname *sh-paper* *sh-main-scale*))))
          (setq *sh-last-layout* name)
          ;; more sheets on this layout, each a complete sheet beside the previous ones
          (setq n (getint "\nHow many sheets on this layout <1>: ") i 1 scale (cadr pick))
          (while (and n (< i n))
            (setq i (1+ i))
            ;; same title block and scale as the first sheet: only the drawing, its sheet number and its place
            (princ (strcat "\nSheet " (itoa i) " of " (itoa n) " (" typ ", 1:" (itoa scale) "):"))
            (sh:gotomodel)
            (if (and (setq pick (sh:pick typ scale nil)) (setq pick (sh:checkpick pick)))
              (progn (setvar "CTAB" name) (command "_.PSPACE")
                     (setq scale (cadr pick))
                     (sh:sheetbeside name pick typ))
              ;; Enter / Esc at the drawing: stop, the sheets made so far stay
              (setq n i)))
          (if (/= (getvar "CTAB") name) (setvar "CTAB" name))))))
  (sh:end))

;; "A3 1-250", or "A3 1-250 (2)" when taken
(defun sh:autoname (paper scale / base n i)
  (setq base (strcat paper " 1-" (itoa scale)) n base i 1)
  (while (member (strcase n) (mapcar 'strcase (layoutlist))) (setq i (1+ i) n (strcat base " (" (itoa i) ")")))
  n)

(defun sh:rename (old new)
  (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-put-Name (list (vla-Item (vla-get-Layouts (sh:doc)) old) new)))
    old
    (progn (if *sh-msg* (setq *sh-msg* (sh:subst-name *sh-msg* old new))) new)))

(defun sh:subst-name (s old new / i)
  (if (setq i (vl-string-search old s)) (strcat (substr s 1 i) new (substr s (+ i 1 (strlen old)))) s))

(defun c:SHEETADD (/ lays name scale pick bb wP hP pc vps mode side e cx cy tb u blk s fb need typ paper o)
  (sh:begin)
  (setq lays (layoutlist))
  (if (and (/= (getvar "CTAB") "Model") (member (getvar "CTAB") lays)) (setq *sh-last-layout* (getvar "CTAB")))
  (setq name (getstring T (strcat "\nAdd to layout <" (if *sh-last-layout* *sh-last-layout* "") ">: ")))
  (if (= name "") (setq name *sh-last-layout*))
  (if (not (and name (member (strcase name) (mapcar 'strcase lays))))
    (princ "\nNo such layout.")
    (progn
      (setq name (car (vl-member-if '(lambda (x) (= (strcase x) (strcase name))) lays)))
      (sh:gotomodel)
      (setq scale (sh:askscale))
      (if (and (setq pick (sh:pick nil scale nil))
               (progn (sh:setunits (car (car pick)))
                      (setq pick (sh:checkpick pick))))
        (progn
          (setq scale (cadr pick))
          (setvar "CTAB" name)
          (command "_.PSPACE")
          (setq *sh-cur* "" vps (sh:items name '("vp")) bb (sh:bbox vps)
                wP (* (sh:k scale) (cadr (car pick))) hP (* (sh:k scale) (caddr (car pick))))
          (initget "Yes No")
          (setq tb (getkword "\nWith its own title block [Yes/No] <No>: "))
          (if (= tb "Yes")
            (progn (initget "Sheet Paper")
                   (setq mode (if (= (getkword "\nAs [Sheet beside, own paper/Paper shared with this sheet] <Sheet>: ") "Paper")
                                "Unit" "Sheet")))
            (progn (initget "Inside Beside")
                   (setq mode (getkword "\nPlace [Inside the sheet, same paper/Beside, the sheet grows] <Inside>: "))))
          (if (= mode "Sheet")
            ;; a complete sheet of its own (frame, paper, title block) beside the existing one, which stays as it is
            (progn
              (setq *sh-cur* "" typ (car (sh:info name)) *sh-cur* nil)
              (sh:sheetbeside name pick typ)
              (setq pc nil mode "Done")))
          (if (= mode "Unit")
            ;; a unit: the drawing with its own title block, beside the others (the paper grows)
            (progn
              (setq fb (sh:bbox (sh:items name '("frame")))
                    need (+ wP (sh:col (car (sh:stripsize (sh:blockfor (car (sh:info name))))))))
              (if (and fb (> need (* 0.7 (- (car (cadr fb)) (car (car fb))))))
                (progn (princ (strcat "\nAt 1:" (itoa scale) " it needs " (rtos need 2 0) " mm of the "
                                      (rtos (- (car (cadr fb)) (car (car fb))) 2 0)
                                      " mm sheet width (the paper stays). Choose a smaller scale."))
                       (exit)))
              ;; where it goes: a rectangle of its size (drawing + title block column) follows the cursor;
              ;; Enter = on the left. The units are columns side by side, so only the left-right place counts.
              (setq u (sh:nextunit name)
                    pc (if fb (sh:place need (- (cadr (cadr fb)) (cadr (car fb)) (* 2 *sh-inset-gap*)) T
                                        "\nClick where the drawing with its title block goes, Enter = left side: ")))
              (setq pc (cond ((null bb) '(0.0 0.0))
                             (pc (list (- (car pc) (/ (- need wP) 2.0)) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))
                             (T (list (- (car (car bb)) *sh-gap* (/ wP 2.0)) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))))
              (setq e (sh:addvp (car pick) (cadr pick) pc name))
              (sh:addrole e u)
              (if (and (/= (setq blk (sh:blockfor (car (sh:info name)))) "") (setq s (sh:addstrip blk name)))
                (progn (sh:addrole s u)
                       (sh:addloose s name u)
                       ;; next to its drawing until the sheet is fitted
                       (sh:move (list s) (- (car pc) (car (car (sh:stripbb (list s))))) (- (cadr pc) (cadr (car (sh:stripbb (list s))))))))))
          (if (not (member mode '("Beside" "Unit" "Done")))
            ;; inside: placed by hand, the paper stays, the other drawings are cut around it
            (if (setq pc (sh:place wP hP T "\nClick where the new drawing goes (it sits flush near the frame), Enter = beside: "))
              (progn (setq e (sh:addvp (car pick) (cadr pick) pc name))
                     (sh:addrole e "inset"))
              (setq mode "Beside")))
          (if (= mode "Beside")
            (progn
              (initget "Left Right Above Below Click")
              (setq side (getkword "\nSide [Left/Right/Above/Below/Click] <Left>: "))
              (if bb (setq cx (/ (+ (car (car bb)) (car (cadr bb))) 2.0) cy (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))
              (setq pc (cond ((null bb) '(0.0 0.0))
                             ((= side "Right") (list (+ (car (cadr bb)) *sh-gap* (/ wP 2.0)) cy))
                             ((= side "Above") (list cx (+ (cadr (cadr bb)) *sh-gap* (/ hP 2.0))))
                             ((= side "Below") (list cx (- (cadr (car bb)) *sh-gap* (/ hP 2.0))))
                             ((= side "Click") (sh:place wP hP nil "\nClick where the new drawing goes: "))
                             (T (list (- (car (car bb)) *sh-gap* (/ wP 2.0)) cy))))
              (if pc (sh:addvp (car pick) (cadr pick) pc name))))
          (if pc (sh:fit nil nil))
          (setq *sh-last-layout* name)))))
  (sh:end))

;; title block layout of the current sheet: column <-> corner (the drawing also under the title block)
(defun c:SHEETWRAP (/ lay f r new)
  (sh:begin)
  (setq *sh-cur* "")
  (if (or (= (getvar "TILEMODE") 1) (null (setq f (car (sh:items (setq lay (getvar "CTAB")) '("frame"))))))
    (princ "\nGo to a sheet made by SHEET first.")
    (progn
      (command "_.PSPACE")
      (setq r (sh:roles f)
            new (cond ((= (nth 4 r) "corner") "column")
                      ((= (nth 4 r) "column") "corner")
                      ;; by the paper: corner from A2 up (the frame is the paper less the margins)
                      ((>= (apply 'min (mapcar '- (cadr (sh:bbox (list f))) (car (sh:bbox (list f))))) 380.0) "column")
                      (T "corner")))
      (sh:tag f (mapcar '(lambda (q) (cons 1000 (if q q ""))) (list (nth 0 r) (nth 1 r) (nth 2 r) (nth 3 r) new)))
      (sh:fit nil nil)
      (setq *sh-msg* (strcat (if *sh-msg* *sh-msg* "") (if (= new "corner") " - drawing under the title block too" " - title block column")))))
  (sh:end))

;; every drawing on the sheet grows to the frame, the title block or the next drawing; the scale and what is
;; in the middle stay
(defun c:SHEETFILL ()
  (sh:begin)
  (if (= (getvar "TILEMODE") 1)
    (princ "\nGo to the sheet layout first.")
    (progn (command "_.PSPACE")
           (foreach k (sh:sheetkeys (getvar "CTAB")) (setq *sh-cur* k) (sh:fill))))
  (sh:end))

;; SHEETFILL on the current sheet (*sh-cur*)
(defun sh:fill (/ lay area vps r rs o gap e others sbox dv)
  (if T
    (progn
      (setq lay (getvar "CTAB") gap *sh-inset-gap*)
      ;; units with their own title blocks: each drawing fills its own part already
      (if (cdr (sh:unitkeys (vl-remove-if 'sh:inset-p (sh:items lay '("vp"))))) (setq lay nil))
      (if lay (progn
      (foreach e (sh:items lay '("vp")) (sh:sync e) (sh:unclip e))
      (setq area (sh:bbox (sh:items lay '("frame"))) vps (sh:items lay '("vp")) sbox nil
            dv (sh:items lay '("divider")) o (sh:bbox dv))
      (cond ((null o))
            ;; column layout: the drawings stop at the line beside the title block
            ((null (cdr dv)) (setq area (list (car area) (list (car (car o)) (cadr (cadr area))))))
            ;; corner layout: the title block corner is in the way, the rest of the frame is free
            (T (setq sbox (list (car (car o)) (cadr (car o)) (car (cadr area)) (cadr (cadr area))))))
      (setq area (list (car (car area)) (cadr (car area)) (car (cadr area)) (cadr (cadr area))))
      (foreach e (vl-remove-if '(lambda (v) (or (sh:inset-p v) (sh:poly-p v))) vps)
        (setq r (sh:vprect e)
              others (mapcar '(lambda (v) (sh:grow (sh:vprect v) gap)) (vl-remove e vps)))
        (if sbox (setq others (cons sbox others)))
        ;; right, left, top, bottom: up to the area or the nearest drawing on that side
        (setq rs (nth 2 area))
        (foreach o others (if (and (< (nth 1 o) (nth 3 r)) (> (nth 3 o) (nth 1 r)) (>= (nth 0 o) (- (nth 2 r) 1e-6)))
                            (setq rs (min rs (nth 0 o)))))
        (setq r (list (nth 0 r) (nth 1 r) rs (nth 3 r)) rs (nth 0 area))
        (foreach o others (if (and (< (nth 1 o) (nth 3 r)) (> (nth 3 o) (nth 1 r)) (<= (nth 2 o) (+ (nth 0 r) 1e-6)))
                            (setq rs (max rs (nth 2 o)))))
        (setq r (list rs (nth 1 r) (nth 2 r) (nth 3 r)) rs (nth 3 area))
        (foreach o others (if (and (< (nth 0 o) (nth 2 r)) (> (nth 2 o) (nth 0 r)) (>= (nth 1 o) (- (nth 3 r) 1e-6)))
                            (setq rs (min rs (nth 1 o)))))
        (setq r (list (nth 0 r) (nth 1 r) (nth 2 r) rs) rs (nth 1 area))
        (foreach o others (if (and (< (nth 0 o) (nth 2 r)) (> (nth 2 o) (nth 0 r)) (<= (nth 3 o) (+ (nth 1 r) 1e-6)))
                            (setq rs (max rs (nth 3 o)))))
        (setq r (list (nth 0 r) rs (nth 2 r) (nth 3 r)))
        (sh:setrect e r nil))))
      (sh:fit nil nil))))

(defun sh:pickvp (/ es e r bb)
  (if (= (getvar "TILEMODE") 1)
    (progn (princ "\nGo to the sheet layout first.") nil)
    (progn
      (if (/= (getvar "CVPORT") 1) (command "_.PSPACE"))
      (if (setq es (entsel "\nSelect the drawing (viewport): "))
        (progn
          (setq e (car es))
          (cond ((member "vp" (sh:roles e)) (setq r e))
                (T (foreach v (sh:items (getvar "CTAB") '("vp")) (if (equal (sh:clip v) e) (setq r v)))))
          ;; the frame lies on the viewport edge: take the viewport under the picked point
          (if (not r)
            (foreach v (sh:items (getvar "CTAB") '("vp"))
              (if (and (not r) (setq bb (sh:bbox (list v)))
                       (<= (- (car (car bb)) 0.5) (car (cadr es)) (+ (car (cadr bb)) 0.5))
                       (<= (- (cadr (car bb)) 0.5) (cadr (cadr es)) (+ (cadr (cadr bb)) 0.5)))
                (setq r v))))))
      (if (not r) (princ "\nThat is not a drawing placed by SHEET."))
      r)))

(defun c:SHEETSCALE (/ e x old new k1 k2 cl vp cW)
  (sh:begin)
  (if (setq e (sh:pickvp))
    (progn
      (setq *sh-cur* (sh:sheetkey e) x (sh:reals (sh:sync e)) old (fix (+ (car x) 0.5)))
      (setq new (getint (strcat "\nNew scale 1: <" (itoa old) ">: ")))
      (if (and new (> new 0) (/= new old))
        (progn
          (setq k1 (sh:k old) k2 (sh:k new) vp (vlax-ename->vla-object e) cW (list (nth 1 x) (nth 2 x) 0.0))
          (vla-put-DisplayLocked vp :vlax-false)
          (if (setq cl (sh:clip e))
            (vla-ScaleEntity (vlax-ename->vla-object cl) (vlax-3d-point (sh:vpcenter e)) (/ k2 k1))
            (progn (vla-put-Width vp (* k2 (nth 3 x))) (vla-put-Height vp (* k2 (nth 4 x)))))
          (sh:setview vp cW (nth 5 x) k2)
          (sh:tag e (append (mapcar '(lambda (r) (cons 1000 r)) (sh:roles e))
                            (list (cons 1040 (float new)) (cons 1040 (nth 1 x)) (cons 1040 (nth 2 x))
                                  (cons 1040 (nth 3 x)) (cons 1040 (nth 4 x)) (cons 1040 (nth 5 x)))))
          (sh:fit nil nil)))))
  (sh:end))

;; the drawing (viewport) under a point clicked on the sheet; the smallest one when they overlap (an inset)
(defun sh:pickin (msg / p r best a)
  (if (setq p (getpoint msg))
    (foreach v (sh:items (getvar "CTAB") '("vp"))
      (setq r (sh:vprect v))
      (if (and (<= (nth 0 r) (car p) (nth 2 r)) (<= (nth 1 r) (cadr p) (nth 3 r))
               (or (null best) (< (* (- (nth 2 r) (nth 0 r)) (- (nth 3 r) (nth 1 r))) a)))
        (setq best v a (* (- (nth 2 r) (nth 0 r)) (- (nth 3 r) (nth 1 r)))))))
  (if (and p (not best)) (princ "\nNo drawing placed by SHEET there."))
  best)

;; move what a drawing shows inside its viewport (the viewport is locked, so PAN moves the paper):
;; point -> where it goes, again and again, Enter when done. The scale stays; SHEETFIT keeps the new view.
(defun c:SHEETPAN (/ doc e vp x k v p1 p2 go)
  (sh:begin)
  (if (= (getvar "TILEMODE") 1)
    (princ "\nGo to the sheet layout first.")
    (progn
      (command "_.PSPACE")
      (if (setq e (sh:pickin "\nClick inside the drawing to move: "))
        (progn
          (setq doc (sh:doc) vp (vlax-ename->vla-object e) x (sh:reals (sh:sync e)) k (sh:k (car x)) v (sh:vpview e) go T)
          (while go
            (vla-put-DisplayLocked vp :vlax-false)
            (vla-put-MSpace doc :vlax-true)
            (vla-put-ActivePViewport doc vp)
            (if (and (setq p1 (getpoint "\nPoint in the drawing to move <done>: "))
                     (setq p2 (getpoint p1 "\nWhere it goes: ")))
              (progn
                (setq v (mapcar '- v (mapcar '- (trans p2 1 0) (trans p1 1 0))))
                (sh:setview vp (list (car v) (cadr v) 0.0) (nth 5 x) k))
              (setq go nil)))
          (vla-put-MSpace doc :vlax-false)
          (vla-put-DisplayLocked vp :vlax-false)
          (sh:tag e (append (mapcar '(lambda (r) (cons 1000 r)) (sh:roles e))
                            (list (cons 1040 (car x)) (cons 1040 (car v)) (cons 1040 (cadr v))
                                  (cons 1040 (nth 3 x)) (cons 1040 (nth 4 x)) (cons 1040 (nth 5 x)))))))))
  (sh:end))

(defun c:SHEETFIT ()
  (sh:begin)
  (if (= (getvar "TILEMODE") 1)
    (princ "\nGo to the sheet layout first.")
    (progn (command "_.PSPACE")
           ;; every sheet on the layout, each on its own
           (foreach k (sh:sheetkeys (getvar "CTAB")) (sh:fitsheet k nil nil))))
  (sh:end))

(defun c:SHEETSIZE (/ lay info s o w h f)
  (sh:begin)
  (setq *sh-cur* "")
  (if (= (getvar "TILEMODE") 1)
    (princ "\nGo to the sheet layout first.")
    (progn
      (setq lay (getvar "CTAB") info (sh:info lay))
      (initget "Auto A4 A3 A2 A1 A0 Custom")
      (setq s (getkword "\nSheet size [Auto/A4/A3/A2/A1/A0/Custom] <Auto>: "))
      (cond ((or (null s) (= s "Auto")) (setq s ""))
            ((= s "Custom")
             (setq w (getreal "\nWidth (mm): ") h (getreal "\nHeight (mm): "))
             (setq s (if (and w h) (strcat (rtos w 2 0) "," (rtos h 2 0)) "")))
            (T (initget "Landscape Portrait")
               (setq o (getkword "\n[Landscape/Portrait] <Landscape>: "))
               (setq s (strcat s (if (= o "Portrait") "P" "L")))))
      (if (setq f (car (sh:items lay '("frame")))) (entdel f))
      (command "_.PSPACE")
      (sh:fit (car info) s)))
  (sh:end))

;; double-click on a block with attributes (the CUI double-click action of "Attribute Block" runs this):
;; a title block opens in the block editor, so editing it once changes every sheet; any other block opens the
;; attribute editor as before.
(defun c:SHEETDBL (/ ss e n b)
  (setq ss (ssget "_I") e (if ss (ssname ss 0)))
  (if e
    (progn
      (setq n (if (= (cdr (assoc 0 (entget e))) "INSERT") (vla-get-EffectiveName (vlax-ename->vla-object e)) ""))
      (if (or (member "strip" (sh:roles e)) (member (strcase n) '("SHOVAL" "SHOVAL_MAVAT"))
              (member n (list (sh:blockfor "Construction") (sh:blockfor "Tabaa"))))
        ;; BEDIT takes the selected insert (by name it would open the block dialog); then zoom to the title block
        ;; itself (parts far from it would zoom far out)
        (progn (setq b (sh:stripbox n))
               (sssetfirst nil (ssadd e))
               (command "_.BEDIT")
               (if (and b (= (getvar "BLOCKEDITOR") 1))
                 (command "_.ZOOM" "_W" (list (- (nth 0 b) 10.0) (- (nth 1 b) 10.0)) (list (+ (nth 2 b) 10.0) (+ (nth 3 b) 10.0)))))
        (command "_.EATTEDIT" e))))
  (princ))

(defun c:SHEETBLOCK (/ typ e blk d f)
  (sh:begin)
  (initget "Construction Tabaa")
  (setq typ (getkword "\nTitle block for [Construction/Tabaa] <Construction>: "))
  (if (null typ) (setq typ "Construction"))
  (princ (strcat "\nNow: " (sh:blockfor typ)))
  (setq e (car (entsel "\nSelect the title block (block insert), or Enter to type its name: ")))
  (setq blk (if (and e (= (cdr (assoc 0 (entget e))) "INSERT"))
              (vla-get-EffectiveName (vlax-ename->vla-object e))
              (getstring T "\nBlock name: ")))
  (if (and blk (/= blk "") (tblsearch "BLOCK" blk))
    (progn
      (setenv (strcat "OriSheet" typ) blk)
      (setq *sh-stripsize* nil)
      (sh:prepblock blk)
      (princ (strcat "\n" typ " title block = " blk))
      (if (setq d (sh:libdir))
        (progn
          (setq f (strcat d blk ".dwg"))
          (if (findfile f) (vl-file-delete f))
          (command "_.-WBLOCK" f blk)
          (if (findfile f) (princ (strcat "\nSaved to the library: " f))))))
    (princ "\nNo such block."))
  (sh:end))

(princ "\nsheets.lsp loaded: SHEET, SHEETADD, SHEETSCALE, SHEETFIT, SHEETFILL, SHEETPAN, SHEETWRAP, SHEETUNITS, SHEETSIZE, SHEETBLOCK")
(princ)
