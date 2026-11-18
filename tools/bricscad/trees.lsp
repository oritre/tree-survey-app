;;; trees.lsp - updates the tree survey marks in the surveyor's DWG from the tree survey app.
;;;
;;; Since app 1.95.0 (no Excel): the app (on this PC, folder connected in its settings "BricsCAD במחשב") writes a data
;;; file per construction survey to  G:\האחסון שלי\סקרי עצים\BricsCAD\oritrees-<survey id>.tsv  (another folder:
;;; (setenv "OriTreesDir" "X:\\folder\\")). TREESFILE picks the survey from the app's list (oritrees-index.tsv).
;;; TREESTABLE saves designations to oritrees-edits.tsv (only BricsCAD writes it); the app reads it every second.
;;; After a change in the app, the app sends TREESSYNC-like (ts:cadsync) through oritrees_link.pyw, and at the end of
;;; every BricsCAD command the drawing is drawn again when the app's file changed. TREESPICK = mark a tree in the app.
;;; Drawings linked to an Excel move to the app's file by themselves (same Excel name in the app's list).
;;;
;;; Older way (still works for a drawing without an app survey):
;;; The tree survey app writes a sheet named "מדידה" into the construction survey Excel:
;;;   A tree number | B X | C Y | D label X | E label Y | F surveyor no. | G designation (from column BC)
;;;   H surveyor block handle | I designation code | J area name | K area points "X,Y;X,Y;..."
;;; Code (column I): 1 not required in license, 2 transplant, 3 preserve, 4 cut, 0 none.
;;;
;;; Commands
;;;   TREES       draw / update the trees from the Excel (asks for the file the first time)
;;;   TREESFILE   choose a different Excel file for this drawing
;;;   TREESRESET  delete everything this command drew (the block insert included)
;;;
;;; Needs BricsCAD (or AutoCAD) on Windows with Microsoft Excel installed: the Excel is read through Excel itself,
;;; so the designations are read even while the file is open in Excel (save it first to be safe).
;;; Re-running TREES rebuilds the block from the Excel (colors, numbers, new trees). Marks drawn loose by older
;;; versions (or the app's older marks file) are removed and the block is placed where they were, even if moved.
;;; The surveyor's own tree blocks are never changed.
;;; All the trees, their numbers and squares and the areas are ONE block named "trees" (*ts-block*), inserted once.
;;; Move, rotate or copy that one insert (also to another drawing); TREES refills the block from the Excel and the
;;; insert stays where you put it. Do not explode it.
;;; With ori's TREEBLK.lsp loaded (OriTools), TREES draws ori's own tree blocks instead: tyouth (blue, not required
;;; in license), thaataka (orange, transplant), tshimur (red, preserve), takira (yellow, cut), t_new (green, no
;;; designation yet), on layer "Symbols", at the TREEBLK size; the number is centred on the tree on layer
;;; "tree_survey" (no leader) and the square is TREEBLK's square.

(vl-load-com)

(setq *ts-app* "TREESURVEY")
(setq *ts-txt* 0.5)   ; number height (m)
(setq *ts-r* 0.45)    ; ring radius (m)
(setq *ts-w* 0.12)    ; ring width (m)
(setq *ts-block* "trees") ; block inserted at every tree
;; designation code -> ori's TREEBLK block (0 none, 1 not required, 2 transplant, 3 preserve, 4 cut)
(setq *ts-ori-blocks* '("t_new" "tyouth" "thaataka" "tshimur" "takira"))

;; code -> (layer color)   colors as in the Excel template's conditional formatting
(setq *ts-layers*
  '((0 "TREE-NO-STATUS" 3)
    (1 "TREE-LO-NIDRASH" 5)
    (2 "TREE-HAATAKA" 30)
    (3 "TREE-SHIMUR" 1)
    (4 "TREE-KRITA" 2)))
(setq *ts-num-layer* '("TREE-NUM" 7))
(setq *ts-area-layer* '("TREE-AREAS" 6))
;; area as ori draws it: black boundary, TRIANGLES hatch (scale 5 in drawing units, his cm drawings) colored by the
;; area's designation like his tree blocks, name in the middle (color 7 = black on his background and in print)
(setq *ts-area-hatch* '("TRIANGLES" 5.0))
(setq *ts-area-name-color* 7)
(setq *ts-area-line-color* 7)
;; designation code -> triangles color: none/not required blue, transplant orange, preserve red, cut yellow
(setq *ts-area-colors* '((0 . 5) (1 . 5) (2 . 30) (3 . 1) (4 . 2)))

(defun ts:layer (spec)
  (if (not (tblsearch "LAYER" (car spec)))
    (entmake (list '(0 . "LAYER") '(100 . "AcDbSymbolTableRecord") '(100 . "AcDbLayerTableRecord")
                   (cons 2 (car spec)) '(70 . 0) (cons 62 (cadr spec)) '(6 . "Continuous"))))
  (car spec))

(defun ts:xd (num role) (list (list -3 (list *ts-app* (cons 1000 num) (cons 1000 role)))))

(defun ts:str (v)
  (cond ((null v) "")
        ((numberp v) (if (equal v (fix v) 1e-9) (itoa (fix v)) (rtos v 2 2)))
        (T (vl-string-trim " \t" v))))

(defun ts:num (v / n)
  (cond ((numberp v) (float v))
        ((and (= (type v) 'STR) (setq n (distof (vl-string-trim " " v) 2))) n)
        (T nil)))

;; ---------- Excel ----------
;; this open workbook is the Excel file: same full path, or (OneDrive: FullName is a web address) same file name
(defun ts:samewb (w path)
  (or (= (strcase (vlax-get-property w 'FullName)) (strcase path))
      (= (strcase (vlax-get-property w 'Name)) (strcase (strcat (vl-filename-base path) (vl-filename-extension path))))))
(defun ts:val (v)
  (if (= (type v) 'VARIANT)
    (if (member (vlax-variant-type v) '(0 1 10)) nil (vlax-variant-value v))
    v))

;; rows of the "מדידה" sheet (found by its headers B1="X", C1="Y"), as lists of values
(defun ts:read (path / xl was wbs wb opened sh rows val)
  (if (ts:tsvp path) (ts:tsvrows path)
  (progn
  (setq was (vl-catch-all-apply 'vlax-get-object (list "Excel.Application")))
  (if (vl-catch-all-error-p was) (setq was nil))
  (setq xl (vlax-get-or-create-object "Excel.Application"))
  (if (null xl) (progn (princ "\nExcel is not installed on this computer.") (exit)))
  (setq wbs (vlax-get-property xl 'Workbooks))
  (vlax-for w wbs
    (if (ts:samewb w path) (setq wb w)))
  (if (null wb)
    (setq wb (vlax-invoke-method wbs 'Open path 0 :vlax-true) opened T)
    (if (= (vlax-get-property xl 'Visible) :vlax-true) (ts:xlhook xl)))
  (vl-catch-all-apply 'vlax-invoke-method (list xl 'Calculate))
  (vlax-for s (vlax-get-property wb 'Worksheets)
    (if (and (null sh)
             (= (ts:str (ts:val (vlax-get-property (vlax-get-property s 'Range "B1") 'Value2))) "X")
             (= (ts:str (ts:val (vlax-get-property (vlax-get-property s 'Range "C1") 'Value2))) "Y"))
      (setq sh s)))
  (if sh
    (progn
      (setq val (vlax-variant-value (vlax-get-property (vlax-get-property sh 'Range "A1:L2000") 'Value2)))
      (setq rows (mapcar '(lambda (r) (mapcar 'ts:val r)) (cdr (vlax-safearray->list val))))))
  (if opened (vlax-invoke-method wb 'Close :vlax-false))
  (if (and (null was) opened) (vl-catch-all-apply 'vlax-invoke-method (list xl 'Quit)))
  (foreach o (list sh wb wbs xl) (if (and o (not (vlax-object-released-p o))) (vlax-release-object o)))
  (gc)
  (if (null sh) (progn (princ "\nNo plan sheet (B1=X, C1=Y) in this Excel. Export the Excel again from the app, version 1.33 or later.") (exit)))
  rows)))

;; ---------- what was drawn before ----------
;; list of (num role ename)
(defun ts:existing (/ ss i e xd out)
  (if (setq ss (ssget "_X" (list (list -3 (list *ts-app*)))))
    (progn
      (setq i 0)
      (repeat (sslength ss)
        (setq e (ssname ss i) i (1+ i))
        (setq xd (cdr (assoc *ts-app* (cdr (assoc -3 (entget e (list *ts-app*)))))))
        (setq out (cons (list (cdr (nth 0 xd)) (cdr (nth 1 xd)) e) out)))))
  out)

(defun ts:find (lst num role / r)
  (foreach x lst (if (and (= (car x) num) (= (cadr x) role)) (setq r (caddr x))))
  r)

;; ---------- drawing: everything goes into ONE block "trees" ----------
;; The block's own coordinates are the Excel X,Y (base point 0,0). The drawing has one insert of it: move,
;; rotate or copy that insert (also to another drawing) and the next TREES fills it again from the Excel.
(defun ts:pt (p) (vlax-3d-point (car p) (cadr p) 0.0))
(defun ts:arr (pts / l)
  (setq l (apply 'append (mapcar '(lambda (p) (list (car p) (cadr p))) pts)))
  (vlax-make-variant (vlax-safearray-fill (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length l)))) l)))
(defun ts:on (o lay) (vla-put-Layer o lay) o)

(defun ts:text-pt (e / d)
  (setq d (entget e))
  (if (and (= (cdr (assoc 72 d)) 0) (= (cdr (assoc 73 d)) 0)) (cdr (assoc 10 d)) (cdr (assoc 11 d))))

;; color of an area's triangles: its designation code from the sheet (column L), else from its own record (same
;; number as the area's name, e.g. P256: a T line in the app's file)
(defun ts:areacolor (r rows / code nm)
  (setq code (ts:num (nth 11 r)) nm (strcase (ts:str (nth 9 r))))
  (if (null code)
    (foreach q rows (if (and (null code) (= (strcase (ts:str (nth 0 q))) nm)) (setq code (ts:num (nth 8 q))))))
  (cdr (cond ((assoc (fix (cond (code) (0))) *ts-area-colors*)) ((assoc 0 *ts-area-colors*)))))
;; area centre (polygon centroid), for the area's name
(defun ts:centroid (pts / a cx cy p q f n)
  (setq a 0.0 cx 0.0 cy 0.0 n (length pts))
  (repeat n
    (setq p (car pts) q (cadr pts) pts (append (cdr pts) (list p)))
    (setq f (- (* (car p) (cadr q)) (* (car q) (cadr p))) a (+ a f)
          cx (+ cx (* (+ (car p) (car q)) f)) cy (+ cy (* (+ (cadr p) (cadr q)) f))))
  (if (> (abs a) 1e-9) (list (/ cx (* 3.0 a)) (/ cy (* 3.0 a)))))
(defun ts:top (pts / hi) (foreach p pts (if (or (null hi) (> (cadr p) (cadr hi))) (setq hi p))) (list (car hi) (+ (cadr hi) (* 1.5 *ts-txt*))))

;; text centred on p, inside the block
(defun ts:addtext (blk p s ht lay / o)
  (setq o (vla-AddText blk s (ts:pt p) ht))
  (vla-put-Alignment o 10) ; middle centre
  (vla-put-TextAlignmentPoint o (ts:pt p))
  (if *ts-rot* (vla-put-Rotation o (- *ts-rot*))) ; upright on screen even when the insert is rotated
  (if (and tb:textstyle (tblsearch "STYLE" tb:textstyle)) (vla-put-StyleName o tb:textstyle))
  (ts:on o lay))

(defun ts:addsq (blk c h lay / o a)
  ;; square around c, turned back by the insert's rotation so it looks straight on screen
  (setq a (- (cond (*ts-rot*) (0.0))))
  (setq o (vla-AddLightWeightPolyline blk
            (ts:arr (mapcar '(lambda (d) (list (+ (car c) (- (* (car d) (cos a)) (* (cadr d) (sin a))))
                                               (+ (cadr c) (+ (* (car d) (sin a)) (* (cadr d) (cos a))))))
                            (list (list (- h) (- h)) (list h (- h)) (list h h) (list (- h) h))))))
  (vla-put-Closed o :vlax-true)
  (ts:on o lay))

;; the block definition "trees", emptied (created if missing)
(defun ts:emptyblock (doc / blks blk lst)
  (setq blks (vla-get-Blocks doc))
  (if (tblsearch "BLOCK" *ts-block*)
    (progn
      (setq blk (vla-Item blks *ts-block*))
      (vlax-for o blk (setq lst (cons o lst)))
      (foreach o lst (vla-Delete o))
      (vla-put-Origin blk (vlax-3d-point 0 0 0)))
    (setq blk (vla-Add blks (vlax-3d-point 0 0 0) *ts-block*)))
  blk)

;; the insert of the whole block in this drawing (not a per-tree mark of older versions)
(defun ts:role (e / xd) (setq xd (cdr (assoc *ts-app* (cdr (assoc -3 (entget e (list *ts-app*))))))) (if xd (cdr (nth 1 xd))))
(defun ts:wholeins (/ ss i e r n)
  (setq n 0)
  (if (setq ss (ssget "_X" (list '(0 . "INSERT") (cons 2 *ts-block*))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (not (equal (ts:role e) "ring")) (setq r e n (1+ n)))))
  ;; several inserts (copies) all show this one block, so every copy updates. Inside the block a tree is 1.5 m,
  ;; so each copy shows it right at its own scale (1 where the drawing is in m, 100 where it is in cm).
  r)

;; ---------- ori's tree blocks (TREEBLK.lsp) ----------
;; block name for this code, when TREEBLK is loaded and the block is in the drawing or its library
(defun ts:oriblock (code / bn)
  (if (and tb:fromlib tb:size tb:sqr tb:wanted tb:layer)
    (progn
      (setq bn (nth code *ts-ori-blocks*))
      (if (and bn (vl-catch-all-apply 'tb:fromlib (list bn)) (tblsearch "BLOCK" bn)) bn))))

;; size of a TREEBLK block at scale 1 (measured once on a temporary insert)
(defun ts:unitsize (bn / o mn mx r)
  (if (not (assoc bn *ts-usize*))
    (progn
      (setq o (vla-InsertBlock (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object))) (vlax-3d-point 0 0 0) bn 1.0 1.0 1.0 0.0))
      (setq r (vl-catch-all-apply 'vla-GetBoundingBox (list o 'mn 'mx)))
      (setq *ts-usize* (cons (cons bn (if (vl-catch-all-error-p r) 1.0
                                        (progn (setq mn (vlax-safearray->list mn) mx (vlax-safearray->list mx))
                                               (max (- (car mx) (car mn)) (- (cadr mx) (cadr mn))))))
                             *ts-usize*))
      (vla-Delete o)))
  (cdr (assoc bn *ts-usize*)))

;; Inside the block "trees" everything is in Excel units = meters. The insert of the block takes it to the
;; drawing's units (scale 1 in a meter drawing, 100 in a cm drawing). So a tree is 1.5 m INSIDE the block
;; whatever the drawing units are; TSIZE of this drawing (in drawing units) is used when it gives a sensible size.
(setq *ts-tree-m* 1.5)
(defun ts:treem (bn S / sc m)
  (setq sc (car (tb:size)))
  (if (and sc S (> S 0.0)) (setq m (/ (* sc (ts:unitsize bn)) S)))
  (if (and m (>= m 0.3) (<= m 10.0)) m *ts-tree-m*))

;; drawing units per meter from INSUNITS (nil when unknown)
(defun ts:upm (/ u)
  (setq u (getvar "INSUNITS"))
  (cond ((= u 6) 1.0) ((= u 5) 100.0) ((= u 4) 1000.0) ((= u 14) 10.0) (T nil)))

;; scale for a NEW insert of the block: the factor (1, 100, 1000, 10) that puts the Excel points (meters, ITM)
;; inside what is already drawn. INSUNITS is only a fallback, because it is often wrong in surveyors' files.
(defun ts:guessscale (rows / mn mx pts best bn n k dx dy)
  (setq mn (getvar "EXTMIN") mx (getvar "EXTMAX"))
  (foreach r rows
    (if (and (ts:num (nth 1 r)) (ts:num (nth 2 r))) (setq pts (cons (list (ts:num (nth 1 r)) (ts:num (nth 2 r))) pts))))
  (if (and pts (< (car mn) (car mx)))
    (progn
      (setq dx (* 0.1 (- (car mx) (car mn))) dy (* 0.1 (- (cadr mx) (cadr mn))) bn 0)
      (foreach k '(1.0 100.0 1000.0 10.0)
        (setq n 0)
        (foreach p pts
          (if (and (<= (- (car mn) dx) (* k (car p)) (+ (car mx) dx)) (<= (- (cadr mn) dy) (* k (cadr p)) (+ (cadr mx) dy)))
            (setq n (1+ n))))
        (if (> n bn) (setq best k bn n)))))
  (cond (best) ((ts:upm)) (1.0)))

;; ---------- moved drawing ----------
;; where an existing tree mark is now (block insert, or the ring of older versions)
(defun ts:center (e / d pts v)
  (setq d (entget e))
  (cond
    ((member (cdr (assoc 0 d)) '("INSERT" "CIRCLE"))
     (list (car (cdr (assoc 10 d))) (cadr (cdr (assoc 10 d)))))
    (T
     (if (= (cdr (assoc 0 d)) "POLYLINE")
       (progn (setq v (entnext e))
              (while (and v (= (cdr (assoc 0 (entget v))) "VERTEX"))
                (setq pts (cons (cdr (assoc 10 (entget v))) pts) v (entnext v))))
       (setq pts (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 10)) d))))
     (list (/ (apply '+ (mapcar 'car pts)) (length pts)) (/ (apply '+ (mapcar 'cadr pts)) (length pts))))))

;; ---------- marks file from older app versions ----------
;; The app's markup DXF before version 1.48 has no TREESURVEY data. Its marks are found by layer
;; (TREES_NUM numbers, the tree circle next to each number, TREES_BOX squares, TREES_POLY areas) and tagged,
;; so TREES updates them instead of drawing a second set.
(defun ts:tagged (e) (assoc -3 (entget e (list *ts-app*))))
(defun ts:tag (e num role) (entmod (append (entget e) (ts:xd num role))))
(defun ts:untagged (flt / ss i e out)
  (if (setq ss (ssget "_X" flt))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (not (ts:tagged e)) (setq out (cons e out)))))
  out)
(defun ts:adopt (/ marks boxes e num p q best bd d n)
  (setq n 0
        marks (vl-remove-if '(lambda (m) (wcmatch (strcase (cdr (assoc 8 (entget m)))) "TREES_NUM,TREES_BOX,TREES_POLY,TREES_KAV_KACHOL,TREES_REF"))
                (ts:untagged '((0 . "CIRCLE,INSERT") (8 . "TREES_*"))))
        boxes (ts:untagged '((0 . "POLYLINE,LWPOLYLINE") (8 . "TREES_BOX"))))
  (foreach e (ts:untagged '((0 . "TEXT") (8 . "TREES_NUM")))
    (setq num (ts:str (cdr (assoc 1 (entget e)))) p (ts:text-pt e)
          q (list (- (car p) 1.1) (- (cadr p) 0.6)) best nil bd 0.6)
    ;; the number is 1.1 m right and 0.6 m above its tree; if the drawing was rotated, the nearest tree to it
    (foreach m marks (if (< (setq d (distance q (ts:center m))) bd) (setq best m bd d)))
    (if (null best) (progn (setq bd 1.6) (foreach m marks (if (< (setq d (distance p (ts:center m))) bd) (setq best m bd d)))))
    (if (and best (/= num ""))
      (progn
        (setq q (ts:center best) marks (vl-remove best marks) n (1+ n))
        (ts:tag best num "ring")
        (ts:tag e num "num")
        (foreach b boxes (if (< (distance q (ts:center b)) 0.3) (ts:tag b num "box"))))))
  (foreach e (ts:untagged '((0 . "POLYLINE,LWPOLYLINE") (8 . "TREES_POLY"))) (ts:tag e "" "area"))
  (foreach e (ts:untagged '((0 . "TEXT") (8 . "TREES_POLY"))) (ts:tag e "" "areaname"))
  (if (> n 0) (princ (strcat "\nFound " (itoa n) " trees from the app's marks file.")))
  n)

;; move + rotation from pairs ((excel-pt drawing-pt) ...): (a b tx ty), X = a x - b y + tx, Y = b x + a y + ty
;; one pair = move only; two or more = the two pairs farthest apart give the rotation too
(defun ts:fit (pairs / p1 p2 d dx dy ux uy n a b)
  (if pairs
    (progn
      (setq p1 (car pairs) d 0.0)
      (foreach q (cdr pairs) (if (> (distance (car p1) (car q)) d) (setq p2 q d (distance (car p1) (car q)))))
      (if (> d 1.0)
        (setq dx (- (car (car p2)) (car (car p1))) dy (- (cadr (car p2)) (cadr (car p1)))
              ux (- (car (cadr p2)) (car (cadr p1))) uy (- (cadr (cadr p2)) (cadr (cadr p1)))
              n (+ (* dx dx) (* dy dy))
              a (/ (+ (* dx ux) (* dy uy)) n) b (/ (- (* dx uy) (* dy ux)) n))
        (setq a 1.0 b 0.0))
      (list a b
            (- (car (cadr p1)) (- (* a (car (car p1))) (* b (cadr (car p1)))))
            (- (cadr (cadr p1)) (+ (* b (car (car p1))) (* a (cadr (car p1)))))))))

;; "X,Y;X,Y;..." -> ((x y) ...)
(defun ts:pts (s / out part i)
  (setq s (ts:str s))
  (while (> (strlen s) 0)
    (setq i (vl-string-search ";" s))
    (setq part (if i (substr s 1 i) s) s (if i (substr s (+ i 2)) ""))
    (if (setq i (vl-string-search "," part))
      (setq out (cons (list (atof (substr part 1 i)) (atof (substr part (+ i 2)))) out))))
  (reverse out))

;; ---------- the file for this drawing ----------
;; The Excel of this drawing, also after the survey folder (Excel + DWG together) was moved, e.g. Desktop -> Drive:
;; 1. an Excel with the same name in the DWG's own folder (it wins over the old place: the folder moves together)
;; 2. the stored path, if it still exists
;; 3. the only Excel in the DWG's folder with a sheet "סקר"
;; A new place is saved in the drawing. nil = not found.
(defun ts:relocate (p / dir c h ok found)
  (setq dir (getvar "DWGPREFIX"))
  (cond
    ((and p (setq c (findfile (strcat dir (vl-filename-base p) (vl-filename-extension p))))
          (/= (strcase c) (strcase p)))
     (setq found c))
    ((and p (findfile p)) p)
    ((= (getvar "DWGTITLED") 0) nil)
    (T
     (foreach f (append (vl-directory-files dir "*.xlsm" 1) (vl-directory-files dir "*.xlsx" 1))
       (if (/= (substr f 1 2) "~$")
         (progn
           (setq c (strcat dir f) h (vl-catch-all-apply 'ts:xlopen (list c)))
           (if (not (vl-catch-all-error-p h))
             (progn (if (ts:sheet (cadr h) "סקר") (setq ok (cons c ok)))
                    (vl-catch-all-apply 'ts:xlclose (list h nil)))))))
     (if (= (length ok) 1) (setq found (car ok)))))
  (if found
    (progn (vlax-ldata-put "TREESURVEY" "excel" found)
           (princ (strcat (if p "\nThe survey folder moved: this drawing now uses " "\nThe survey Excel in the drawing's folder: ") found))
           found)
    (if (and p (findfile p)) p)))

(defun ts:xlpath (ask / p old)
  (setq p (vlax-ldata-get "TREESURVEY" "excel") old p)
  (if (not ask) (setq p (ts:relocate p)))
  (if (or ask (null p) (not (findfile p)))
    (progn
      (setq p (getfiled "Tree survey Excel (from the app)" (if old (strcat (getvar "DWGPREFIX") (vl-filename-base old) (vl-filename-extension old)) "") "xlsm;xlsx" 0))
      (if p (progn (vlax-ldata-put "TREESURVEY" "excel" p) (vlax-ldata-delete "TREESURVEY" "survey")))))
  p)
;; the file of this drawing: the app's data file (survey linked, or an Excel drawing moved to it), else the Excel.
;; ask = TREESFILE: pick the survey from the app's list (or an Excel file)
;; TREES never opens the Excel file dialog by itself (1.110.1): when the app's list is there it offers the list,
;; when the app is not connected on this PC it says how to connect it (and uses the drawing's Excel only if it is found).
(defun ts:path (ask / id p)
  (if ask
    (progn
      (setq id (ts:picksurvey))
      (cond ((= id 'excel) (ts:xlpath T))
            (id (vlax-ldata-put "TREESURVEY" "survey" id) (ts:datafile id))))
    (progn
      (setq id (cond ((vlax-ldata-get "TREESURVEY" "survey")) ((ts:migrate))))
      (cond
        ((and id (findfile (setq p (ts:datafile id)))) p)
        ;; the app is connected (its list of surveys is there): pick this drawing's survey from it
        ((ts:index)
         (if id (princ "\nThe app's file of this drawing's survey is missing: pick the survey again."))
         (setq id (ts:picksurvey))
         (cond ((= id 'excel) (ts:xlpath T))
               (id (vlax-ldata-put "TREESURVEY" "survey" id) (ts:datafile id))))
        ;; the app does not write its files on this PC yet
        (T
         (ts:noapp)
         (if (and (setq p (vlax-ldata-get "TREESURVEY" "excel")) (setq p (ts:relocate p)))
           (progn (princ (strcat "\nDrawn from the Excel " p " (not from the app).")) p)))))))
;; once a session: the app is not connected to BricsCAD on this PC
(defun ts:noapp ()
  (princ (strcat "\nNo app files in " (ts:dir) ". In the app on this PC: Settings > BricsCAD במחשב > choose the folder G:\\האחסון שלי\\סקרי עצים."))
  (if (null *ts-noapp*)
    (progn
      (setq *ts-noapp* T)
      (alert (strcat "האפליקציה עוד לא שולחת את הסקרים ל-BricsCAD במחשב הזה, ולכן TREES לא רואה את השינויים שעשית בה.\n\n"
                     "באפליקציה במחשב (לא בטאבלט): הגדרות > BricsCAD במחשב > בחר תיקייה, ובחר את התיקייה\n"
                     "G:\\האחסון שלי\\סקרי עצים\n\n"
                     "אחר כך הפעל שוב TREES ובחר את הסקר מהרשימה.\n"
                     "(תיקיית הקבצים: " (ts:dir) ")")))))

;; ---------- commands ----------
(defun ts:run (path / doc rows old x y lx ly code lay num c e tp cnt areas pairs tr bn sc sz blk ins ms ce rot k pts S anames)
  (princ (strcat "\nReading " path " ..."))
  (setq rows (ts:read path) cnt 0 areas 0 *ts-usize* nil)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)) ms (vla-get-ModelSpace doc))
  (vla-StartUndoMark doc)
  ;; TREEBLK's reactors stay quiet while TREES draws
  (setq tb:busy T ce (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)
  (ts:adopt)
  (setq old (ts:existing) ins (ts:wholeins))
  ;; older versions drew every tree loose in the drawing. Where they were (maybe moved) tells where the block goes
  (if (null ins)
    (progn
      (foreach r rows
        (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
        (if (and (/= num "") x y (setq e (ts:find old num "ring")) (entget e))
          (setq pairs (cons (list (list x y) (ts:center e)) pairs))))
      (setq tr (ts:fit pairs))))
  (foreach o old
    (if (and (member (cadr o) '("ring" "box" "num" "lead" "area" "areaname")) (entget (caddr o)))
      (entdel (caddr o))))
  ;; scale of the block insert (Excel meters -> drawing units)
  (setq tr (cond (ins nil) (tr) (T (list (ts:guessscale rows) 0.0 0.0 0.0)))
        S (if ins (abs (vla-get-XScaleFactor (vlax-ename->vla-object ins)))
                  (sqrt (+ (* (nth 0 tr) (nth 0 tr)) (* (nth 1 tr) (nth 1 tr))))))
  ;; rotation of the insert: trees, numbers and squares are turned back by it (about each tree's centre),
  ;; so they stay straight on screen when the plan was rotated
  (setq *ts-rot* (if ins (vla-get-Rotation (vlax-ename->vla-object ins)) (atan (nth 1 tr) (nth 0 tr))))
  ;; fill the block from the Excel, in Excel coordinates
  (setq blk (ts:emptyblock doc))
  ;; the block is in the drawing's own units, so its insert gets no extra unit conversion
  (vl-catch-all-apply 'vla-put-Units (list blk (getvar "INSUNITS")))
  ;; an area's own record (e.g. P256) is the area, not a tree: no tree mark for it
  (setq anames nil)
  (foreach r rows (if (/= (ts:str (nth 9 r)) "") (setq anames (cons (strcase (ts:str (nth 9 r))) anames))))
  ;; areas first, so the tree marks are drawn over the boundary and the fill
  (foreach r rows
    (if (and (nth 10 r) (> (length (setq pts (ts:pts (nth 10 r)))) 2))
      (progn
        (setq lay (ts:layer *ts-area-layer*) k (vla-AddLightWeightPolyline blk (ts:arr pts)))
        (vla-put-Closed k :vlax-true) (ts:on k lay)
        (vla-put-Color k *ts-area-line-color*)
        ;; triangles fill inside the boundary (skipped if the pattern is missing)
        (vl-catch-all-apply
          '(lambda (/ h lp)
             (setq h (vla-AddHatch blk acHatchPatternTypePreDefined (car *ts-area-hatch*) :vlax-false))
             (setq lp (vlax-make-safearray vlax-vbObject '(0 . 0)))
             (vlax-safearray-put-element lp 0 k)
             (vla-AppendOuterLoop h lp)
             (vla-put-PatternScale h (/ (cadr *ts-area-hatch*) S)) ; the block is scaled by S, so the triangles look as in the drawing
             (vla-put-PatternAngle h (- (cond (*ts-rot*) (0.0))))
             (vla-Evaluate h)
             (ts:on h lay)
             (vla-put-Color h (ts:areacolor r rows))))
        (if (/= (ts:str (nth 9 r)) "")
          (vla-put-Color (ts:addtext blk (cond ((ts:centroid pts)) ((ts:top pts))) (ts:str (nth 9 r)) (* 1.5 *ts-txt*) lay)
                         *ts-area-name-color*))
        (setq areas (1+ areas)))))
  (foreach r rows
    (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
    (if (and (/= num "") x y (not (member (strcase num) anames)))
      (progn
        (setq c (list x y) cnt (1+ cnt)
              lx (ts:num (nth 3 r)) ly (ts:num (nth 4 r))
              code (fix (cond ((ts:num (nth 8 r))) (0)))
              bn (ts:oriblock code))
        (if bn
          ;; ori's tree block by designation, number centred on it, square for a tree added in the field
          (progn
            (tb:layer tb:blocklayer) (tb:layer tb:textlayer)
            (setq sz (ts:treem bn S) sc (/ sz (ts:unitsize bn)))
            (ts:on (vla-InsertBlock blk (ts:pt c) bn sc sc sc (- *ts-rot*)) tb:blocklayer)
            (if (= (ts:str (nth 7 r)) "") (ts:addsq blk c (/ (* (tb:sqr) sz) 2.0) tb:textlayer))
            (ts:addtext blk c num (* (cadr (tb:size)) sz) tb:textlayer))
          ;; without TREEBLK: ring by designation, number next to it with a leader
          (progn
            (setq lay (ts:layer (cdr (cond ((assoc code *ts-layers*)) ((assoc 0 *ts-layers*))))))
            (ts:on (vla-AddCircle blk (ts:pt c) *ts-r*) lay)
            (if (= (ts:str (nth 7 r)) "") (ts:addsq blk c (+ *ts-r* 0.25) lay))
            (setq tp (if (and lx ly) (list lx ly) (list (+ x *ts-r* *ts-txt*) y)))
            (ts:addtext blk tp num *ts-txt* (ts:layer *ts-num-layer*))
            (if (> (distance c tp) (+ *ts-r* (* 1.4 *ts-txt*)))
              (ts:on (vla-AddLine blk (ts:pt (polar c (angle c tp) *ts-r*)) (ts:pt (polar c (angle c tp) (- (distance c tp) (* 0.6 *ts-txt*)))))
                     (ts:layer *ts-num-layer*))))))))
  ;; the one insert of the block: kept where you put it; new = where the older loose marks were, else in place
  (if ins
    (vla-Update (vlax-ename->vla-object ins))
    (progn
      (setq rot (atan (nth 1 tr) (nth 0 tr)))
      (setq e (vlax-vla-object->ename (vla-InsertBlock ms (vlax-3d-point (nth 2 tr) (nth 3 tr) 0.0) *ts-block* S S S rot)))
      (entmod (append (entget e) (ts:xd *ts-block* "all")))))
  (vla-Regen doc 1)
  (setq tb:busy nil tb:pending nil tb:dbpend nil *ts-rot* nil)
  (setvar "CMDECHO" ce)
  (vla-EndUndoMark doc)
  (princ (strcat "\nTREES: " (itoa cnt) " trees" (if (> areas 0) (strcat ", " (itoa areas) " areas") "")
                 " in block \"" *ts-block* "\"" (if bn " (your tree blocks)" "")
                 ", block scale " (rtos S 2 2) (cond ((equal S 1.0 1e-6) " (meter drawing)") ((equal S 100.0 1e-6) " (cm drawing)") ((equal S 1000.0 1e-6) " (mm drawing)") (""))
                 ", tree " (rtos (* S (if sz sz (* 2 *ts-r*))) 2 2) " drawing units."))
  (setq *ts-tp* nil *ts-pl* nil)
  (if (ts:tsvp path) (setq *ts-seen* (ts:stamp path)) (ts:xlwatch path))
  (princ))

;; the add-in watches the Excel file (every 3 s) and sends TREESXLSYNC when it changes on disk, e.g. when the app
;; wrote a designation to it in Google Drive. *ts-xlw* keeps Excel running (hidden) while BricsCAD runs.
(defun ts:xlwatch (path)
  (vl-catch-all-apply '(lambda ()
    (if (or (null *ts-xlw*) (vlax-object-released-p *ts-xlw*)
            (vl-catch-all-error-p (vl-catch-all-apply 'vlax-get-property (list *ts-xlw* 'Visible))))
      (setq *ts-xlw* (vlax-get-or-create-object "Excel.Application")))
    (ts:xlhook *ts-xlw*)
    (vlax-invoke-method *ts-xlw* 'Run "OriTrees.xlam!OriTreesWatch" path)))
  (princ))

(defun c:TREES (/ p new)
  (regapp *ts-app*)
  (setq new (and (null (vlax-ldata-get "TREESURVEY" "excel")) (null (vlax-ldata-get "TREESURVEY" "survey"))))
  (if (setq p (ts:path nil)) (progn (ts:run p) (if new (c:TREESTABLE))))
  (princ))

(defun c:TREESFILE (/ p)
  (regapp *ts-app*)
  (if (setq p (ts:path T)) (progn (ts:run p) (c:TREESTABLE)))
  (princ))

(defun c:TREESRESET (/ n)
  (setq n 0)
  (foreach o (ts:existing) (if (entget (caddr o)) (progn (entdel (caddr o)) (setq n (1+ n)))))
  (princ (strcat "\nDeleted " (itoa n) " objects. Run TREES to draw them again."))
  (princ))

;; Optional: update automatically when a drawing that already has an Excel file is opened.
;; Call (ts:auto) from on_doc_load.lsp to enable it.
(defun ts:auto (/ p)
  (regapp *ts-app*)
  (cond
    ((setq p (ts:linked)) (vl-catch-all-apply 'ts:run (list p)))
    ((and (null (vlax-ldata-get "TREESURVEY" "survey")) (ts:migrate) (setq p (ts:linked))) (vl-catch-all-apply 'ts:run (list p)))
    ((and (setq p (vlax-ldata-get "TREESURVEY" "excel")) (setq p (ts:relocate p)))
     (vl-catch-all-apply 'ts:run (list p))))
  (princ))

;; ---------- TREESTABLE: the survey's main table (טבלת מידע מרכזת) inside BricsCAD ----------
;; The table of the Excel this drawing uses (the one TREES draws from): number, species, quantity, height,
;; weighted diameter, total value, category, proposed status (no trunk 1-3). Pick rows and set the status
;; (it is written to column BC of the Excel, sheet "סקר"); "Show" (or a double-click) zooms to the tree; "Pick"
;; selects the tree you click in the drawing. "Save" writes the changes to the Excel and runs TREES again, so
;; the tree colors follow.
(setq *ts-status* '("" "שימור" "כריתה" "העתקה" "לא נדרש ברישיון"))

;; open the Excel (or use it when it is already open in Excel) -> (xl wb opened was)
(defun ts:xlopen (path / was xl wbs wb opened)
  (setq was (vl-catch-all-apply 'vlax-get-object (list "Excel.Application")))
  (if (vl-catch-all-error-p was) (setq was nil))
  (setq xl (vlax-get-or-create-object "Excel.Application"))
  (if (null xl) (progn (princ "\nExcel is not installed on this computer.") (exit)))
  (setq wbs (vlax-get-property xl 'Workbooks))
  (vlax-for w wbs (if (and (null wb) (ts:samewb w path)) (setq wb w)))
  (if (null wb) (setq wb (vlax-invoke-method wbs 'Open path 0 :vlax-false) opened T))
  (list xl wb opened was))
(defun ts:xlclose (h save / xl wb)
  (setq xl (nth 0 h) wb (nth 1 h))
  (if save (vlax-invoke-method wb 'Save))
  (if (nth 2 h) (vlax-invoke-method wb 'Close :vlax-false))
  (if (and (null (nth 3 h)) (nth 2 h)) (vl-catch-all-apply 'vlax-invoke-method (list xl 'Quit)))
  (foreach o (list wb xl) (if (and o (not (vlax-object-released-p o))) (vlax-release-object o)))
  (gc))
(defun ts:sheet (wb name / r)
  (vlax-for s (vlax-get-property wb 'Worksheets) (if (= (vlax-get-property s 'Name) name) (setq r s)))
  r)

;; rows of the main table: ((excel-row num species qty height diameter value category status) ...)
(defun ts:tableread (path / h sh val rows i num out ls st)
  (if (ts:tsvp path) (ts:tsvtable path) (progn
  (setq h (ts:xlopen path))
  (vl-catch-all-apply 'vlax-invoke-method (list (car h) 'Calculate))
  (if (setq sh (ts:sheet (cadr h) "סקר"))
    (setq val (vlax-variant-value (vlax-get-property (vlax-get-property sh 'Range "A11:BC1400") 'Value2))
          rows (mapcar '(lambda (r) (mapcar 'ts:val r)) (vlax-safearray->list val))))
  ;; the status choices = the Excel list "יעוד עצים" ('חד גזעי'!AB5:AB12), plus empty
  (if (setq ls (ts:sheet (cadr h) "חד גזעי"))
    (progn
      (foreach r (vlax-safearray->list (vlax-variant-value (vlax-get-property (vlax-get-property ls 'Range "AB5:AB12") 'Value2)))
        (if (and (/= (setq st (ts:str (ts:val (car r)))) "") (not (member st out))) (setq out (cons st out))))
      (if out (setq *ts-status* (cons "" (reverse out)) out nil))))
  (ts:xlclose h nil)
  (if (null sh) (progn (princ "\nNo sheet \"סקר\" in this Excel.") (exit)))
  (setq i 10)
  (foreach r rows
    (setq i (1+ i) num (ts:str (nth 44 r)))   ; AS = tree number
    (if (and (/= num "") (/= num "0") (ts:num (nth 44 r)) (/= (ts:str (nth 45 r)) "") (/= (ts:str (nth 45 r)) "0"))
      (setq out (cons (list i num (ts:str (nth 45 r)) (ts:str (nth 46 r)) (ts:str (nth 47 r)) (ts:str (nth 51 r))
                            (ts:str (nth 52 r)) (ts:str (nth 53 r)) (ts:str (nth 54 r)))
                      out))))
  (reverse out))))

;; list indices "0 3 5" shifted by d (the header is row 0 of the list); the header itself is dropped
(defun ts:shift (v d / l)
  (setq l (vl-remove-if 'minusp (mapcar '(lambda (i) (+ i d)) (read (strcat "(" (if v v "") ")")))))
  (if l (vl-string-trim "()" (vl-princ-to-string l)) ""))
(defun ts:pad (s n) (if (> (strlen s) n) (substr s 1 n) s))
(defun ts:rowtext (r st)
  (strcat st "\t" (nth 7 r) "\t" (nth 6 r) "\t" (nth 5 r) "\t" (nth 4 r) "\t" (nth 3 r) "\t" (nth 2 r) "\t" (nth 1 r)))

;; where a tree is now in the drawing: Excel X,Y through the "trees" insert (moved / scaled / rotated)
;; every insert (copy) of the "trees" block, rings left out
(defun ts:allins (/ ss i e out)
  (if (setq ss (ssget "_X" (list '(0 . "INSERT") (cons 2 *ts-block*))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (not (equal (ts:role e) "ring")) (setq out (cons e out)))))
  out)

;; where a tree is now in the drawing: Excel X,Y through each "trees" insert (moved / scaled / rotated).
;; With several copies a tree is listed once per copy: ((num x y) ...) and the scale
(defun ts:treepts (path / inss d p s a out sc rows)
  (setq inss (ts:allins) rows (ts:read path))
  (foreach r rows
    (if (and (ts:num (nth 1 r)) (ts:num (nth 2 r)) (/= (ts:str (nth 0 r)) ""))
      (if inss
        (foreach ins inss
          (setq d (entget ins) p (cdr (assoc 10 d)) s (cdr (assoc 41 d)) a (cdr (assoc 50 d)) sc (abs s))
          (setq out (cons (list (ts:str (nth 0 r))
                                (+ (car p) (* s (- (* (cos a) (ts:num (nth 1 r))) (* (sin a) (ts:num (nth 2 r))))))
                                (+ (cadr p) (* s (+ (* (sin a) (ts:num (nth 1 r))) (* (cos a) (ts:num (nth 2 r)))))))
                          out)))
        (setq out (cons (list (ts:str (nth 0 r)) (ts:num (nth 1 r)) (ts:num (nth 2 r))) out)))))
  (list (reverse out) (if sc sc 1.0)))

;; all places of one tree, the one nearest to the middle of the screen first
(defun ts:places (num pts / c l)
  (setq c (trans (getvar "VIEWCTR") 1 0))
  (foreach q pts (if (= (car q) num) (setq l (cons (cdr q) l))))
  (vl-sort l '(lambda (u v) (< (distance (list (car c) (cadr c)) u) (distance (list (car c) (cadr c)) v)))))

(defun ts:zoomto (pt sc)
  (vla-ZoomCenter (vlax-get-acad-object) (vlax-3d-point (car pt) (cadr pt) 0.0) (* 20.0 sc))
  (grdraw (list (- (car pt) sc) (- (cadr pt) sc)) (list (+ (car pt) sc) (+ (cadr pt) sc)) 1)
  (grdraw (list (- (car pt) sc) (+ (cadr pt) sc)) (list (+ (car pt) sc) (- (cadr pt) sc)) 1))

(defun ts:tabledcl (/ f fn)
  (setq fn (vl-filename-mktemp "treestable" nil ".dcl") f (open fn "w"))
  (foreach l
    '("trees_table : dialog { label = \"Tree table\";"
      "  : list_box { key = \"lst\"; width = 106; height = 30; multiple_select = true; tabs = \"18 28 35 43 50 56 96\"; tab_truncate = true; }"
      "  : row {"
      "    : popup_list { key = \"st\"; label = \"Status\"; width = 30; }"
      "    : button { key = \"set\"; label = \"Set status of selected trees\"; }"
      "  }"
      "  : row {"
      "    : button { key = \"zoom\"; label = \"Show in drawing\"; }"
      "    : button { key = \"pick\"; label = \"Pick tree in drawing\"; }"
      "  }"
      "  : text { key = \"msg\"; }"
      "  : row {"
      "    : button { key = \"accept\"; label = \"Save + TREES\"; is_default = true; }"
      "    : button { key = \"cancel\"; label = \"Close without saving\"; is_cancel = true; }"
      "  }"
      "}")
    (write-line l f))
  (close f)
  fn)

(defun ts:ms () (* 86400000.0 (rem (getvar "DATE") 1.0)))

;; a fresh click in the drawing: the click on the dialog button can arrive again as a point,
;; so a click counts only after the mouse moved in the drawing. Enter / right click / Esc = nil
(defun ts:pickpt (/ g mv pt done)
  (princ "\nClick a tree (Enter = back): ")
  (setq mv 0)
  (while (not done)
    (setq g (vl-catch-all-apply 'grread (list T 15 0)))
    (cond
      ((vl-catch-all-error-p g) (setq done T))
      ((= (car g) 5) (setq mv (1+ mv)))
      ((= (car g) 3) (if (> mv 2) (setq pt (cadr g) done T)))
      ((member (car g) '(11 12 25)) (setq done T))
      ((and (= (car g) 2) (member (cadr g) '(13 32 27))) (setq done T))))
  pt)

(defun c:TREESTABLE (/ pl k ans t0 path rows pts tp sc pend sel code dcl id i r pt best bd d tr n h sh msg)
  (regapp *ts-app*)
  (if (null (setq path (ts:path nil))) (exit))
  (princ (if (ts:tsvp path) "\nReading the table from the app ..." "\nReading the table from Excel ..."))
  (setq rows (ts:tableread path) tp (ts:treepts path) pts (car tp) sc (cadr tp) code 2 msg "" *ts-tblseen* (ts:stamp path))
  (if (null rows) (progn (princ "\nNo trees in the table of this survey.") (exit)))
  (setq dcl (ts:tabledcl) id (load_dialog dcl))
  (while (> code 1)
    (if (not (new_dialog "trees_table" id)) (exit))
    (start_list "lst")
    (add_list "סטאטוס מוצע\tערכיות\tסך ערך\tקוטר\tגובה\tכמות\tמין העץ\tמספר")
    (foreach r rows (add_list (ts:rowtext r (cond ((cdr (assoc (car r) pend))) ((nth 8 r))))))
    (end_list)
    (start_list "st") (foreach s *ts-status* (add_list (if (= s "") "(ריק)" s))) (end_list)
    (if sel (set_tile "lst" (ts:shift sel 1)))
    (set_tile "msg" (strcat msg (if pend (strcat "  " (itoa (length pend)) " change(s) not saved yet.") "")))
    (action_tile "lst" "(setq sel (ts:shift $value -1)) (ts:tblcheck path) (if (= $reason 4) (done_dialog 2))")
    (action_tile "set" "(setq sel (ts:shift (get_tile \"lst\") -1)) (done_dialog 4)")
    (action_tile "zoom" "(setq sel (ts:shift (get_tile \"lst\") -1)) (done_dialog 2)")
    (action_tile "pick" "(done_dialog 3)")
    (action_tile "accept" "(done_dialog 1)")
    (action_tile "cancel" "(done_dialog 0)")
    (if (numberp h) (set_tile "st" (itoa h)))
    (setq h (atoi (get_tile "st")))
    (action_tile "st" "(setq h (atoi $value)) (ts:tblcheck path)")
    (setq code (start_dialog) msg "")
    (cond
      ;; status for the selected rows (kept until Save)
      ((= code 4)
       (foreach k (read (strcat "(" (if sel sel "") ")"))
         (setq r (nth k rows) pend (cons (cons (car r) (nth h *ts-status*)) (vl-remove (assoc (car r) pend) pend))))
       (setq msg (strcat "Status \"" (if (= (nth h *ts-status*) "") "(empty)" (nth h *ts-status*)) "\" set."))
       (setq code 5))
      ;; zoom to the first selected tree, then back to the table
      ((= code 2)
       (if (and sel (/= sel "") (setq r (nth (car (read (strcat "(" sel ")"))) rows)))
         (if (setq pl (ts:places (nth 1 r) pts))
           (progn
             (setq k 0 ans "N")
             (while (= ans "N")
               (ts:zoomto (nth k pl) sc)
               (if (> (length pl) 1)
                 (progn
                   (initget "Next")
                   (setq ans (getkword (strcat "\nTree " (nth 1 r) ", place " (itoa (1+ k)) " of " (itoa (length pl))
                                               " - Next place / Enter to return to the table [Next]: ")))
                   (setq ans (if (= ans "Next") "N" nil) k (rem (1+ k) (length pl))))
                 (progn (getstring (strcat "\nTree " (nth 1 r) " - Enter to return to the table: ")) (setq ans nil)))))
           (setq msg (strcat "Tree " (nth 1 r) " has no place in the plan sheet."))))
       (setq code 5))
      ;; click near a tree in the drawing: its row gets selected
      ((= code 3)
       ;; the click on the dialog button can arrive as the point: a click within 0.5 s is asked again
       (setq pt (ts:pickpt))
       (if pt
         (progn
           (setq pt (trans pt 1 0))
           (setq best nil bd nil)
           (foreach q pts (setq d (distance (list (car pt) (cadr pt)) (cdr q))) (if (or (null bd) (< d bd)) (setq best (car q) bd d)))
           (setq i 0 n nil)
           (foreach r rows (if (= (nth 1 r) best) (setq n i)) (setq i (1+ i)))
           (if n (setq sel (itoa n) msg (strcat "Tree " best " selected.")) (setq msg "No tree there."))))
       (setq code 5)))
    (if (= code 5) (setq code 2)))
  (unload_dialog id)
  (vl-file-delete dcl)
  ;; the app's survey: the changes go to the edits file (the app takes them within a second), then draw again
  (if (and (= code 1) pend (ts:tsvp path))
    (progn
      (ts:edits (mapcar '(lambda (c / r) (setq r (assoc (car c) rows))
                           (list "S" (ts:sid path) (car c) (if r (nth 1 r) "") (cdr c) (ts:now)))
                        pend))
      (princ (strcat "\n" (itoa (length pend)) " designation(s) sent to the app."))
      (ts:run path)
      (setq pend nil)))
  ;; write the statuses to the Excel and draw again
  (if (and (= code 1) pend)
    (progn
      (princ "\nWriting to Excel ...")
      (setq h (ts:xlopen path) sh (ts:sheet (cadr h) "סקר"))
      ;; Excel events off while writing, so the Excel add-in (OriTrees.xlam) does not start a second TREES
      (vl-catch-all-apply 'vlax-put-property (list (car h) 'EnableEvents :vlax-false))
      (foreach c pend
        (vlax-put-property (vlax-get-property sh 'Range (strcat "BC" (itoa (car c)))) 'Value2 (cdr c)))
      (vl-catch-all-apply 'vlax-put-property (list (car h) 'EnableEvents :vlax-true))
      (vl-catch-all-apply 'vlax-invoke-method (list (car h) 'Calculate))
      (ts:xlclose h T)
      (princ (strcat "\n" (itoa (length pend)) " status(es) saved in the Excel."))
      (ts:run path)))
  (princ))

;; ---------- Excel beside BricsCAD: the Excel itself is the always-open tree table ----------
;; the workbook open and visible in Excel: (xl wb sheet), or nil with a message
;; the Excel add-in OriTrees.xlam (OriTools): when a status (BC) changes in Excel, it sends TREESXLSYNC to this
;; BricsCAD window (WM_COPYDATA; BricsCAD has no COM registration on ori's PC, so Excel can't reach it by COM)
(defun ts:xlhook (xl / f wbs r)
  (setq f (strcat (getenv "APPDATA") "\\Bricsys\\BricsCAD\\V26x64\\en_US\\Support\\OriTools\\OriTrees.xlam"))
  (if (findfile f)
    (vl-catch-all-apply '(lambda ()
      (setq wbs (vlax-get-property xl 'Workbooks))
      (setq r (vl-catch-all-apply 'vlax-get-property (list wbs 'Item "OriTrees.xlam")))
      (if (vl-catch-all-error-p r) (vlax-invoke-method wbs 'Open f))
      (vlax-invoke-method xl 'Run "OriTrees.xlam!OriTreesStart" (vla-get-HWND (vlax-get-acad-object)))))))

(defun ts:xlside (/ p h sh)
  (if (setq p (ts:path nil))
    (progn
      (setq h (ts:xlopen p))
      (ts:xlhook (car h))
      (vlax-put-property (car h) 'Visible :vlax-true)
      (vl-catch-all-apply 'vlax-put-property (list (car h) 'UserControl :vlax-true))
      (if (setq sh (ts:sheet (cadr h) "סקר"))
        (list (car h) (cadr h) sh)
        (progn (princ "\nNo sheet \"סקר\" in this Excel.") nil)))))

;; TREESXL: Excel as a narrow window on the right of BricsCAD, on the main table (AS..BC)
(defun c:TREESXL (/ x xl wb sh app st bl bt bw bh f tw xw r)
  (if (setq x (ts:xlside))
    (progn
      (setq xl (car x) wb (cadr x) sh (caddr x) app (vlax-get-acad-object))
      (vlax-invoke-method wb 'Activate)
      (vlax-invoke-method sh 'Activate)
      ;; BricsCAD is resized only when it is maximized, and in one step per property: going maximized -> normal ->
      ;; maximized quickly crashed its Qt renderer (2026-11-13). When it is already a normal window, only Excel moves.
      (setq st (vla-get-WindowState app))
      (if (= st 3)
        (progn
          (setq bl (+ (vla-get-WindowLeft app) 8) bt (+ (vla-get-WindowTop app) 8)
                bw (- (vla-get-Width app) 16) bh (- (vla-get-Height app) 16))
          (vlax-put-property xl 'WindowState -4137)
          (setq f (/ (vlax-get-property xl 'Width) (float (+ bw 16))))
          (if (or (< f 0.3) (> f 1.5)) (setq f 0.75))
          (setq *ts-xlgeo* (list bl bt bw bh f)))
        (if *ts-xlgeo* (setq bl (nth 0 *ts-xlgeo*) bt (nth 1 *ts-xlgeo*) bw (nth 2 *ts-xlgeo*) bh (nth 3 *ts-xlgeo*) f (nth 4 *ts-xlgeo*))))
      (setq tw (vl-catch-all-apply 'vlax-get-property (list (vlax-get-property sh 'Range "AS1:BC1") 'Width)))
      (if (vl-catch-all-error-p tw) (setq tw 480.0) (setq tw (vlax-variant-value (vlax-variant-change-type tw 5))))
      (if f
        (progn
          ;; Excel width = the table columns + margins, at most half of the screen
          (setq xw (fix (/ (+ tw 70.0) f)))
          (setq xw (max 420 (min xw (fix (* 0.5 bw)))))
          (if (= st 3)
            (progn (vla-put-WindowState app 1)
                   (vla-put-WindowLeft app bl) (vla-put-WindowTop app bt)
                   (vla-put-Width app (- bw xw)) (vla-put-Height app bh)))
          (vlax-put-property xl 'WindowState -4143)
          (setq r (vl-catch-all-apply '(lambda ()
            (vlax-put-property xl 'Left (* f (+ bl (- bw xw))))
            (vlax-put-property xl 'Top (* f bt))
            (vlax-put-property xl 'Width (* f xw))
            (vlax-put-property xl 'Height (* f bh)))))))
      ;; the main table in view: its header row at the top, the first tree marked
      (vl-catch-all-apply 'vlax-invoke-method (list xl 'Goto (vlax-get-property sh 'Range "AS9") :vlax-true))
      (vl-catch-all-apply 'vlax-invoke-method (list (vlax-get-property sh 'Range "AS11") 'Select))
      ;; the table starts at the window edge, and the zoom makes AS..BC fit in the window (60-100%)
      (vl-catch-all-apply '(lambda (/ win)
        (setq win (vlax-get-property xl 'ActiveWindow))
        (vlax-put-property win 'ScrollColumn 45)
        (if f (vlax-put-property win 'Zoom (max 60 (min 100 (fix (/ (* 100.0 (- (* f xw) 45.0)) tw))))))))
      (princ "\nExcel is beside BricsCAD. In Excel: change the status, then here: TREES. TREESXLGO = jump to the tree marked in Excel, TREESXLPICK = mark in Excel a tree clicked here.")))
  (princ))

;; TREESXLGO: zoom to the tree of the row marked in Excel (again = next copy of the block)
(defun c:TREESXLGO (/ x r num)
  (if (setq x (ts:xlside))
    (progn
      (setq r (vl-catch-all-apply '(lambda () (vlax-get-property (vlax-get-property (car x) 'ActiveCell) 'Row))))
      (if (or (vl-catch-all-error-p r) (< r 11))
        (princ "\nMark a tree row in the Excel table first.")
        (progn
          (setq num (ts:str (ts:val (vlax-get-property (vlax-get-property (caddr x) 'Range (strcat "AS" (itoa r))) 'Value2))))
          (if (or (= num "") (= num "0"))
            (princ "\nNo tree in the marked Excel row.")
            (ts:xlgo num))))))
  (princ))

;; zoom to tree num; the same tree again = its next copy. The Excel add-in calls it on a double-click on a tree
;; number or species in the main table: (ts:xlgo "5")
(defun ts:xlgo (num)
  (if (= num *ts-xlnum*) (setq *ts-xlk* (1+ *ts-xlk*)) (setq *ts-xlnum* num *ts-xlk* 0))
  (ts:panelzoom num *ts-xlk*)
  (princ))

;; TREESXLPICK: click a tree here, its status cell gets marked in Excel
(defun c:TREESXLPICK (/ x pt best bd d vals i row)
  (if (setq x (ts:xlside))
    (progn
      (if (null *ts-tp*) (setq *ts-tp* (ts:treepts (ts:path nil))))
      (if (setq pt (getpoint "\nClick a tree: "))
        (progn
          (setq pt (trans pt 1 0))
          (foreach q (car *ts-tp*) (setq d (distance (list (car pt) (cadr pt)) (cdr q))) (if (or (null bd) (< d bd)) (setq best (car q) bd d)))
          (setq vals (vlax-safearray->list (vlax-variant-value (vlax-get-property (vlax-get-property (caddr x) 'Range "AS11:AS1400") 'Value2))) i 10)
          (foreach v vals (setq i (1+ i)) (if (and (null row) (= (ts:str (ts:val (car v))) best)) (setq row i)))
          (if row
            (progn (vlax-invoke-method (cadr x) 'Activate) (vlax-invoke-method (caddr x) 'Activate)
                   (vlax-invoke-method (vlax-get-property (caddr x) 'Range (strcat "BC" (itoa row))) 'Select)
                   (princ (strcat "\nTree " best " is marked in Excel (row " (itoa row) ").")))
            (princ (strcat "\nTree " best " is not in the Excel table.")))))))
  (princ))

;; TREESXLSYNC: sent by the Excel add-in after a status (BC) change in the open Excel, or when the Excel file
;; changed on disk (the app writes it in Google Drive): draws again
(defun c:TREESXLSYNC (/ p)
  (setq p (vlax-ldata-get "TREESURVEY" "excel"))
  (if (and p (setq p (ts:relocate p)))
    (ts:run p))
  (princ))

;; zoom to tree num, place k (places ordered once, from the screen centre at k = 0)
(defun ts:panelzoom (num k / pl)
  (if (null *ts-tp*) (setq *ts-tp* (ts:treepts (ts:path nil))))
  (if (or (= k 0) (/= (car *ts-pl*) num)) (setq *ts-pl* (cons num (ts:places num (car *ts-tp*)))))
  (setq pl (cdr *ts-pl*))
  (if pl
    (progn (ts:zoomto (nth (rem k (length pl)) pl) (cadr *ts-tp*))
           (princ (strcat "\nTree " num (if (> (length pl) 1) (strcat ", place " (itoa (1+ (rem k (length pl)))) " of " (itoa (length pl)) " (click the row again for the next place)") ""))))
    (princ (strcat "\nTree " num " has no place in the plan sheet.")))
  (princ))

;; ---------- the app's data files (app 1.95.0, no Excel) ----------
;; folder of the app's files: (setenv "OriTreesDir" "...\\") or the default in Google Drive
(defun ts:dir (/ d)
  (setq d (cond ((getenv "OriTreesDir")) ("G:\\האחסון שלי\\סקרי עצים\\BricsCAD\\")))
  (if (/= (substr d (strlen d)) "\\") (strcat d "\\") d))
(defun ts:datafile (id) (strcat (ts:dir) "oritrees-" id ".tsv"))
(defun ts:tsvp (p) (and p (= (strcase (vl-filename-extension p)) ".TSV")))
(defun ts:sid (p / b) (setq b (vl-filename-base p)) (if (wcmatch b "oritrees-*") (substr b 10) b))
;; the data file of this drawing, when it is linked to an app survey and the file is there
(defun ts:linked (/ id p) (if (and (setq id (vlax-ldata-get "TREESURVEY" "survey")) (findfile (setq p (ts:datafile id)))) p))

;; UTF-8 text files through ADODB.Stream (part of Windows; LISP's own open/read-line is not UTF-8 safe)
(defun ts:u8read (p / s r)
  (if (and p (findfile p))
    (progn
      (setq s (vlax-create-object "ADODB.Stream"))
      (setq r (vl-catch-all-apply '(lambda ()
                (vlax-put-property s 'Type 2) (vlax-put-property s 'Charset "utf-8")
                (vlax-invoke-method s 'Open) (vlax-invoke-method s 'LoadFromFile p)
                (vlax-invoke-method s 'ReadText -1))))
      (vl-catch-all-apply 'vlax-invoke-method (list s 'Close))
      (vlax-release-object s)
      (cond ((vl-catch-all-error-p r) nil)
            ((= (type r) 'VARIANT) (vlax-variant-value r))
            (T r)))))
(defun ts:u8write (p text / s r)
  (setq s (vlax-create-object "ADODB.Stream"))
  (setq r (vl-catch-all-apply '(lambda ()
            (vlax-put-property s 'Type 2) (vlax-put-property s 'Charset "utf-8")
            (vlax-invoke-method s 'Open) (vlax-invoke-method s 'WriteText text)
            (vlax-invoke-method s 'SaveToFile p 2))))
  (vl-catch-all-apply 'vlax-invoke-method (list s 'Close))
  (vlax-release-object s)
  (not (vl-catch-all-error-p r)))

;; "a\tb\tc" -> ("a" "b" "c")
(defun ts:split (s ch / out i j)
  (setq i 0)
  (while (setq j (vl-string-search ch s i))
    (setq out (cons (substr s (1+ i) (- j i)) out) i (+ j (strlen ch))))
  (reverse (cons (substr s (1+ i)) out)))
;; the lines of a tsv file, each as a list of fields (BOM and CR dropped, empty lines skipped)
(defun ts:tsv (p / txt out)
  (if (setq txt (ts:u8read p))
    (progn
      (if (= (ascii txt) 65279) (setq txt (substr txt 2)))
      (foreach l (ts:split txt "\n")
        (setq l (vl-string-right-trim "\r" l))
        (if (/= (vl-string-trim " " l) "") (setq out (cons (ts:split l "\t") out))))
      (reverse out))))

;; local time as the app writes it: "2026-11-15 01:05:23"
(defun ts:now (/ d)
  (setq d (rtos (getvar "CDATE") 2 6))
  (strcat (substr d 1 4) "-" (substr d 5 2) "-" (substr d 7 2) " " (substr d 10 2) ":" (substr d 12 2) ":" (substr d 14 2)))
;; designation text -> code (as the Excel formula): 1 not required, 2 transplant, 3 preserve, 4 cut, 0 none
(defun ts:code (st)
  (cond ((or (null st) (= st "")) 0)
        ((vl-string-search "לא נדרש ברישיון" st) 1) ((vl-string-search "העתקה" st) 2)
        ((vl-string-search "שימור" st) 3) ((vl-string-search "כריתה" st) 4) (T 0)))

;; the survey file read, with the designations saved here that the app did not take yet:
;; (head statuses trees areas). head = ("H" id name date written version); tree = ("T" id num X Y LX LY pname status pref code species qty height diam value cat)
(defun ts:data (p / rows head sts trees areas eds)
  (setq rows (ts:tsv p))
  (foreach r rows
    (cond ((= (car r) "H") (setq head r))
          ((= (car r) "L") (setq sts (cdr r)))
          ((= (car r) "T") (setq trees (cons r trees)))
          ((= (car r) "A") (setq areas (cons r areas)))))
  (setq trees (reverse trees) areas (reverse areas))
  ;; designations from TREESTABLE written after the app wrote this file: on top (in their order)
  (foreach e (ts:tsv (strcat (ts:dir) "oritrees-edits.tsv"))
    (if (and (= (car e) "S") (= (nth 1 e) (ts:sid p)) head (>= (nth 5 e) (nth 4 head)))
      (setq trees (mapcar '(lambda (r) (if (= (nth 1 r) (nth 2 e)) (ts:setnth (ts:setnth r 8 (nth 4 e)) 10 (itoa (ts:code (nth 4 e)))) r)) trees))))
  (list head sts trees areas))
(defun ts:setnth (l n v / i) (setq i -1) (mapcar '(lambda (x) (if (= (setq i (1+ i)) n) v x)) l))
(defun ts:f (r n / v) (setq v (nth n r)) (if (and v (/= v "")) v))
;; rows like the Excel's plan sheet A..K: (num X Y LX LY pname status pref code area-name area-points)
(defun ts:tsvrows (p / d out)
  (setq d (ts:data p))
  (if (null (car d)) (progn (princ (strcat "\nCan't read " p ".")) (exit)))
  (foreach r (caddr d)
    (setq out (cons (list (ts:f r 2) (ts:f r 3) (ts:f r 4) (ts:f r 5) (ts:f r 6) (ts:f r 7) (ts:f r 8) (ts:f r 9) (ts:f r 10) nil nil) out)))
  (foreach a (cadddr d)
    (setq out (cons (list nil nil nil nil nil nil nil nil nil (ts:f a 1) (ts:f a 2)) out)))
  (reverse out))
;; rows of the table: ((tree-id num species qty height diameter value category status) ...)
(defun ts:tsvtable (p / d out)
  (setq d (ts:data p))
  (if (cadr d) (setq *ts-status* (cons "" (cadr d))))
  (foreach r (caddr d)
    (setq out (cons (list (nth 1 r) (ts:str (nth 2 r)) (ts:str (nth 11 r)) (ts:str (nth 12 r)) (ts:str (nth 13 r)) (ts:str (nth 14 r))
                          (ts:str (nth 15 r)) (ts:str (nth 16 r)) (ts:str (nth 8 r)))
                    out)))
  (reverse out))

;; add lines to the edits file (kept short: the last 300 lines)
(defun ts:edits (lines / f old all n)
  (setq f (strcat (ts:dir) "oritrees-edits.tsv") old (ts:tsv f))
  (setq all (append old lines) n (length all))
  (if (> n 300) (setq all (member (nth (- n 300) all) all)))
  (if (not (ts:u8write f (apply 'strcat (mapcar '(lambda (l) (strcat (ts:join l "\t") "\r\n")) all))))
    (princ (strcat "\nCould not write " f "."))))
(defun ts:join (l ch / s) (setq s (car l)) (foreach x (cdr l) (setq s (strcat s ch x))) s)

;; the app's list of surveys: ((id name date excel-name updated) ...), newest first
(defun ts:index (/ out) (foreach r (ts:tsv (strcat (ts:dir) "oritrees-index.tsv")) (if (/= (car r) "id") (setq out (cons r out)))) (reverse out))
;; a drawing linked to an Excel: the app survey with the same Excel name (the app's file name = the address)
(defun ts:migrate (/ x b hit)
  (if (setq x (vlax-ldata-get "TREESURVEY" "excel"))
    (progn
      (setq b (strcase (vl-filename-base x)))
      (foreach r (ts:index) (if (and (null hit) (= (strcase (ts:str (nth 3 r))) b)) (setq hit r)))
      (if hit
        (progn (vlax-ldata-put "TREESURVEY" "survey" (car hit))
               (princ (strcat "\nThis drawing now works with the app's survey \"" (nth 1 hit) "\" (" (nth 2 hit) "), without Excel."))
               (car hit))))))
;; TREESFILE: pick the survey from the app's list -> id, 'excel, or nil
(defun ts:picksurvey (/ l fn f id code sel r)
  (setq l (ts:index))
  (if (null l)
    (progn (princ (strcat "\nNo app surveys in " (ts:dir) ". In the app on this PC: Settings > BricsCAD במחשב. Choosing an Excel file instead."))
           'excel)
    (progn
      (setq fn (vl-filename-mktemp "treesfile" nil ".dcl") f (open fn "w"))
      (foreach x '("trees_pick : dialog { label = \"Survey of this drawing\";"
                   "  : list_box { key = \"lst\"; width = 80; height = 22; tabs = \"52\"; tab_truncate = true; }"
                   "  : row { : button { key = \"accept\"; label = \"OK\"; is_default = true; }"
                   "          : button { key = \"xl\"; label = \"Excel file instead...\"; }"
                   "          : button { key = \"cancel\"; label = \"Cancel\"; is_cancel = true; } } }")
        (write-line x f))
      (close f)
      (setq id (load_dialog fn))
      (if (new_dialog "trees_pick" id)
        (progn
          (start_list "lst") (foreach r l (add_list (strcat (ts:str (nth 1 r)) "\t" (ts:str (nth 2 r))))) (end_list)
          (setq sel "0") (set_tile "lst" "0")
          (action_tile "lst" "(setq sel $value) (if (= $reason 4) (done_dialog 1))")
          (action_tile "accept" "(setq sel (get_tile \"lst\")) (done_dialog 1)")
          (action_tile "xl" "(done_dialog 2)")
          (action_tile "cancel" "(done_dialog 0)")
          (setq code (start_dialog))))
      (unload_dialog id) (vl-file-delete fn)
      (cond ((= code 2) 'excel)
            ((and (= code 1) sel (/= sel "") (setq r (nth (atoi sel) l)))
             (princ (strcat "\nThis drawing: " (nth 1 r) " (" (nth 2 r) ")."))
             (car r))))))

;; times of the app's file and of the edits file: a change in either draws again
(defun ts:stamp (p) (list (vl-file-systime p) (vl-file-systime (strcat (ts:dir) "oritrees-edits.tsv"))))
;; the app (oritrees_link.pyw) and the end of every command: draw again when the app's file changed
(defun ts:cadsync (/ p)
  (if (and (setq p (ts:linked)) (not (equal (ts:stamp p) *ts-seen*)))
    ;; inside a running command (the app's message typed at a prompt): later, at the end of that command
    (if (= (logand (getvar "CMDACTIVE") 1) 0) (vl-catch-all-apply 'ts:run (list p))))
  (princ))
(defun c:TREESSYNC () (setq *ts-seen* nil) (ts:cadsync))
(defun ts:cmdend (r a / p)
  ;; not inside a script or a LISP program that runs commands (the line would be typed into it)
  (if (and *ts-seen* (= (logand (getvar "CMDACTIVE") 36) 0) (setq p (ts:linked)) (not (equal (ts:stamp p) *ts-seen*)))
    (vla-SendCommand (vla-get-ActiveDocument (vlax-get-acad-object)) "(ts:cadsync) "))
  (princ))
(if (null *ts-react*) (setq *ts-react* (vlr-command-reactor nil '((:vlr-commandEnded . ts:cmdend)))))

;; TREESTABLE open: on every click in it, the rows are read again when the app changed the file
(defun ts:tblcheck (path / st)
  (if (and (ts:tsvp path) (not (equal (setq st (ts:stamp path)) *ts-tblseen*)))
    (progn
      (setq *ts-tblseen* st rows (ts:tableread path))
      (start_list "lst")
      (add_list "סטאטוס מוצע\tערכיות\tסך ערך\tקוטר\tגובה\tכמות\tמין העץ\tמספר")
      (foreach r rows (add_list (ts:rowtext r (cond ((cdr (assoc (car r) pend))) ((nth 8 r))))))
      (end_list)
      (if sel (set_tile "lst" (ts:shift sel 1)))
      (set_tile "msg" "Updated from the app."))))

;; TREESPICK: click a tree in the drawing, it opens in the app (and is marked in the app's table beside BricsCAD)
(defun c:TREESPICK (/ p pt best bd d r id)
  (if (null (setq p (ts:linked)))
    (princ "\nThis drawing is not linked to an app survey (TREESFILE).")
    (progn
      (setq *ts-tp* (ts:treepts p))
      (if (setq pt (getpoint "\nClick a tree: "))
        (progn
          (setq pt (trans pt 1 0))
          (foreach q (car *ts-tp*) (setq d (distance (list (car pt) (cadr pt)) (cdr q))) (if (or (null bd) (< d bd)) (setq best (car q) bd d)))
          (foreach r (caddr (ts:data p)) (if (and (null id) (= (nth 2 r) best)) (setq id (nth 1 r))))
          (if id
            (progn (ts:edits (list (list "P" (ts:sid p) id best (ts:now))))
                   (princ (strcat "\nTree " best " is marked in the app.")))
            (princ "\nNo tree there."))))))
  (princ))

(princ "\nTree survey loaded. Commands: TREES, TREESFILE, TREESRESET, TREESTABLE, TREESPICK, TREESSYNC, TREESXL, TREESXLGO, TREESXLPICK, TREESXLSYNC")
(princ)
