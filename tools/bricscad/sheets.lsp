;;; sheets.lsp - put a drawing from model space on a layout sheet with a title block (shoval), at a chosen scale.
;;;
;;; Commands
;;;   SHEET       new layout: choose title block type and scale, pick the drawing in model space
;;;               (window / closed polyline / moving frame of a paper size). The sheet size is chosen by itself:
;;;               the smallest of A4..A0 (landscape or portrait) that holds the drawing and the title block,
;;;               otherwise a roll sheet ("gramoshka") of free size, up to 900 x 5000 mm.
;;;   SHEETADD    add another drawing (own scale) to an existing sheet; the sheet grows to hold all drawings.
;;;   SHEETSCALE  change the scale of a drawing on the current sheet; the sheet size is fitted again.
;;;   SHEETFIT    fit the current sheet again (after moving viewports by hand): size, frame, title block, centering.
;;;   SHEETSIZE   force a sheet size on the current sheet (A4..A0, landscape/portrait, custom W x H) or back to Auto.
;;;   SHEETBLOCK  choose which block is the title block of each type, and save it to the OriTools library.
;;;
;;; While picking a frame (SHEET -> Frame): the frame follows the cursor. Type a scale and Enter (e.g. 500),
;;; + / - next / previous common scale, S next paper size, O landscape/portrait, R align to a line, click to place.
;;;
;;; Rotated drawings: if the UCS is rotated when you pick, the drawing is picked in the UCS directions and the
;;; viewport is turned the same way (like UCS + PLAN). Option Rotate: pick two points of a line that should be
;;; horizontal on the sheet.
;;;
;;; The title block is inserted at paper size (1 drawing unit = 1 mm) and exploded, so its texts can be edited on
;;; each sheet. The scale text ("1:250"), the paper size text ("A4"..) and the dates are filled in by themselves.
;;; Model units: meters (any INSUNITS except 4 = millimeters and 1 = inches; 5 is taken as meters too).
;;; Plotter: "Print As PDF.pc3" (or the first plotter with PDF in its name). For a roll sheet the plotter needs a
;;; paper of that size; if it has none you get a message (add a custom paper size in the plotter configuration).

(vl-load-com)

;; title block library: the "sheets" folder next to sheets.lsp. The only place to change when the folder moves.
(setq *sh-libdir* "C:/Users/origr/Downloads/OriSheets/sheets/")

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
(if (not *sh-last-paper*) (setq *sh-last-paper* "A3"))
(if (not *sh-last-orient*) (setq *sh-last-orient* "L"))
(setq *sh-stripsize* nil) ; cache: ((block w h) ...)

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

;; millimeters on paper per model unit. Survey drawings are in meters even when INSUNITS says centimeters (5),
;; so only millimeters (4) and inches (1) are taken from INSUNITS.
(defun sh:upm (/ u)
  (setq u (getvar "INSUNITS"))
  (cond ((= u 4) 1.0) ((= u 1) 25.4) (T 1000.0)))

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
(defun sh:items (lay roles / ss i e r)
  (if (setq ss (ssget "_X" (list (cons 410 lay) (list -3 (list *sh-app*)))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (or (null roles) (member (car (sh:roles e)) roles)) (setq r (cons e r)))))
  r)

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
(defun sh:usable (name pw ph sw shh / m p)
  (setq m (sh:margin name pw ph) p (sh:pad name pw ph))
  (list (- pw (* 2 m) (* 2 p) (sh:col sw)) (- ph (* 2 m) (* 2 p))))

(defun sh:fits (name pw ph gw gh sw shh / u)
  (setq u (sh:usable name pw ph sw shh))
  (and (<= gw (+ (car u) 1e-6)) (<= gh (+ (cadr u) 1e-6))
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

(defun sh:stripsize (blk / c ref bb)
  (cond ((or (null blk) (= blk "")) '(0.0 0.0))
        ((setq c (assoc blk *sh-stripsize*)) (cdr c))
        ((sh:ensureblock blk)
         (setq ref (vla-InsertBlock (vla-get-ModelSpace (sh:doc)) (vlax-3d-point 0 0 0) blk 1.0 1.0 1.0 0.0))
         (setq bb (sh:bbox (list (vlax-vla-object->ename ref))))
         (vla-Delete ref)
         (setq c (list (- (car (cadr bb)) (car (car bb))) (- (cadr (cadr bb)) (cadr (car bb)))))
         (setq *sh-stripsize* (cons (cons blk c) *sh-stripsize*))
         c)
        (T '(0.0 0.0))))

;; insert + explode the title block in the current layout, tag its parts, fill scale / size / date
(defun sh:addstrip (blk lay / ref objs e ed s sub)
  (if (sh:ensureblock blk)
    (progn
      (setq ref (vla-InsertBlock (vla-get-PaperSpace (sh:doc)) (vlax-3d-point 0 0 0) blk 1.0 1.0 1.0 0.0))
      (setq objs (sh:list (vla-Explode ref)))
      (vla-Delete ref)
      (foreach o objs
        (setq e (vlax-vla-object->ename o) ed (entget e) sub nil)
        (if (= (cdr (assoc 0 ed)) "TEXT")
          (progn
            (setq s (cdr (assoc 1 ed)))
            (cond ((= s "1:250") (setq sub "scale"))
                  ((member s '("A4" "A3" "A2" "A1" "A0")) (setq sub "size"))
                  ((or (= s "XX/XX/XXXX") (wcmatch s "#*/#*/####")) (setq sub "date")
                   (entmod (subst (cons 1 (sh:today)) (assoc 1 ed) ed))))))
        (sh:tag e (if sub (list (cons 1000 "strip") (cons 1000 sub)) (list (cons 1000 "strip")))))
      T)
    (progn (princ (strcat "\nTitle block \"" blk "\" not found in this drawing or in the library (SHEETBLOCK)."))
           nil)))

(defun sh:settext (lay sub val / ed)
  (foreach e (sh:items lay '("strip"))
    (if (= (cadr (sh:roles e)) sub)
      (progn (setq ed (entget e)) (entmod (subst (cons 1 val) (assoc 1 ed) ed))))))

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

;; sheet info from its frame: (type forced)
(defun sh:info (lay / f r)
  (if (setq f (car (sh:items lay '("frame"))))
    (progn (setq r (sh:roles f)) (list (cadr r) (caddr r)))
    (list "None" "")))

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

(defun sh:fit (typ forced / lay vps strip sbb sw shh bb gw gh paper pw ph m p colL acx acy dx dy f scs main a big x)
  (setq lay (getvar "CTAB"))
  (if (null typ) (setq typ (car (sh:info lay))))
  (if (null forced) (setq forced (cadr (sh:info lay))))
  (setq vps (sh:items lay '("vp")))
  (if (null vps)
    (princ "\nNo drawing on this sheet. Use SHEET or SHEETADD.")
    (progn
      (setq strip (sh:items lay '("strip")))
      (if strip
        (setq sbb (sh:bbox strip)
              sw (- (car (cadr sbb)) (car (car sbb)))
              shh (- (cadr (cadr sbb)) (cadr (car sbb))))
        (setq sw 0.0 shh 0.0))
      ;; several drawings (or a polyline clip): each viewport shows just the picked part
      (foreach e vps
        (if (not (sh:clip e))
          (progn (setq x (sh:reals e)) (sh:sizevp e (* (sh:k (car x)) (nth 3 x)) (* (sh:k (car x)) (nth 4 x))))))
      ;; the paper is chosen by the picked parts, not by the viewports (they may have grown to the frame)
      (setq bb (sh:corebox vps)
            gw (- (car (cadr bb)) (car (car bb)))
            gh (- (cadr (cadr bb)) (cadr (car bb))))
      (setq paper (cond ((sh:forced forced)) ((sh:choose gw gh sw shh))))
      (setq pw (cadr paper) ph (caddr paper))
      (setq m (sh:margin (car paper) pw ph) p (sh:pad (car paper) pw ph))
      ;; frame and divider
      (foreach e (sh:items lay '("frame" "divider")) (entdel e))
      (setq f (sh:rect m m (- pw m) (- ph m) lay (sh:layer *sh-frame-layer*)))
      (sh:tag f (list (cons 1000 "frame") (cons 1000 typ) (cons 1000 (if forced forced ""))))
      (setq colL (- pw m (sh:col sw)))
      (if strip
        (progn
          (sh:tag (sh:line colL m colL (- ph m) lay (sh:layer *sh-frame-layer*)) (list (cons 1000 "divider")))
          (sh:move strip (- (- pw m *sh-inset*) (car (cadr sbb))) (- (- ph m *sh-inset*) (cadr (cadr sbb))))))
      ;; center the drawings in the free area
      (setq acx (/ (+ m p (- colL p)) 2.0) acy (/ ph 2.0))
      (setq dx (- acx (/ (+ (car (car bb)) (car (cadr bb))) 2.0))
            dy (- acy (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0)))
      (foreach e vps (sh:movevp e dx dy))
      ;; one drawing: the viewport fills the frame up to the title block, the picked part stays in the middle
      (if (and (null (cdr vps)) (not (sh:clip (car vps))))
        (sh:sizevp (car vps) (- colL m) (- ph m m)))
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
      (sh:plot pw ph)
      (command "_.ZOOM" "_E")
      (setq *sh-paper* (sh:papername paper) *sh-main-scale* main)
      ;; shown by sh:end, after the command echo
      (setq *sh-msg* (strcat "\nSheet " lay ": " (sh:papername paper)
                             (if (= (car paper) "ROLL") " mm (roll)" (if (> pw ph) " landscape" " portrait"))
                             ", 1:" (itoa main)))
      ;; a layout named by paper and scale ("A3 1-250") follows the sheet when the scale or the paper changes
      (if (and (wcmatch lay "A# 1-#*,#*x#* 1-#*")
               (not (wcmatch lay (strcat (sh:papername paper) " 1-" (itoa main) ","
                                         (sh:papername paper) " 1-" (itoa main) " (#*)"))))
        (setq *sh-last-layout* (sh:rename lay (sh:autoname (sh:papername paper) main))))))
  (princ))

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
  (vla-put-DisplayLocked vp :vlax-true)
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
  (sh:tag e (list (cons 1000 "vp") (cons 1040 (float scale)) (cons 1040 (car cW)) (cons 1040 (cadr cW))
                  (cons 1040 (cadr sel)) (cons 1040 (caddr sel)) (cons 1040 ang)))
  e)

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
  (if (= r 'cancel) nil r))

;; ---------- commands ----------

(defun sh:begin ()
  (setq *sh-olderr* *error* *sh-oldecho* (getvar "CMDECHO") *sh-oldosmode* (getvar "OSMODE"))
  (setq *error* sh:error *sh-msg* nil *sh-paper* nil)
  (setvar "CMDECHO" 0)
  (vla-StartUndoMark (sh:doc)))

(defun sh:end ()
  (vla-EndUndoMark (sh:doc))
  (setvar "CMDECHO" *sh-oldecho*)
  (setvar "OSMODE" *sh-oldosmode*)
  (setq *error* *sh-olderr*)
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
  (setq *error* *sh-olderr*)
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

(defun c:SHEET (/ typ scale pick name doc lay ss i e blk auto)
  (sh:begin)
  (sh:gotomodel)
  (initget "Construction Tabaa None")
  (setq typ (getkword (strcat "\nTitle block [Construction/Tabaa/None] <" *sh-last-type* ">: ")))
  (if typ (setq *sh-last-type* typ) (setq typ *sh-last-type*))
  (setq scale (sh:askscale))
  (if (setq pick (sh:pick typ scale T))
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
          (if (/= blk "") (sh:addstrip blk name))
          (sh:addvp (car pick) (cadr pick) '(0.0 0.0) name)
          (sh:fit typ (caddr pick))
          (if (and auto *sh-paper*) (setq name (sh:rename name (sh:autoname *sh-paper* *sh-main-scale*))))
          (setq *sh-last-layout* name)))))
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

(defun c:SHEETADD (/ lays name scale pick bb wP pc vps)
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
      (if (setq pick (sh:pick nil scale nil))
        (progn
          (setvar "CTAB" name)
          (command "_.PSPACE")
          ;; new drawing to the left of the drawings already there
          (setq vps (sh:items name '("vp")) bb (sh:corebox vps) wP (* (sh:k scale) (cadr (car pick))))
          (setq pc (if bb
                     (list (- (car (car bb)) *sh-gap* (/ wP 2.0)) (/ (+ (cadr (car bb)) (cadr (cadr bb))) 2.0))
                     '(0.0 0.0)))
          (sh:addvp (car pick) (cadr pick) pc name)
          (sh:fit nil nil)
          (setq *sh-last-layout* name)))))
  (sh:end))

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
      (setq x (sh:reals e) old (fix (car x)))
      (setq new (getint (strcat "\nNew scale 1: <" (itoa old) ">: ")))
      (if (and new (> new 0) (/= new old))
        (progn
          (setq k1 (sh:k old) k2 (sh:k new) vp (vlax-ename->vla-object e) cW (list (nth 1 x) (nth 2 x) 0.0))
          (vla-put-DisplayLocked vp :vlax-false)
          (if (setq cl (sh:clip e))
            (vla-ScaleEntity (vlax-ename->vla-object cl) (vlax-3d-point (sh:vpcenter e)) (/ k2 k1))
            (progn (vla-put-Width vp (* k2 (nth 3 x))) (vla-put-Height vp (* k2 (nth 4 x)))))
          (sh:setview vp cW (nth 5 x) k2)
          (sh:tag e (list (cons 1000 "vp") (cons 1040 (float new)) (cons 1040 (nth 1 x)) (cons 1040 (nth 2 x))
                          (cons 1040 (nth 3 x)) (cons 1040 (nth 4 x)) (cons 1040 (nth 5 x))))
          (sh:fit nil nil)))))
  (sh:end))

(defun c:SHEETFIT ()
  (sh:begin)
  (if (= (getvar "TILEMODE") 1) (princ "\nGo to the sheet layout first.") (progn (command "_.PSPACE") (sh:fit nil nil)))
  (sh:end))

(defun c:SHEETSIZE (/ lay info s o w h f)
  (sh:begin)
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
      (princ (strcat "\n" typ " title block = " blk))
      (if (setq d (sh:libdir))
        (progn
          (setq f (strcat d blk ".dwg"))
          (if (findfile f) (vl-file-delete f))
          (command "_.-WBLOCK" f blk)
          (if (findfile f) (princ (strcat "\nSaved to the library: " f))))))
    (princ "\nNo such block."))
  (sh:end))

(princ "\nsheets.lsp loaded: SHEET, SHEETADD, SHEETSCALE, SHEETFIT, SHEETSIZE, SHEETBLOCK")
(princ)
