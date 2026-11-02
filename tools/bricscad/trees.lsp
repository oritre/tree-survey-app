;;; trees.lsp - updates the tree survey marks in the surveyor's DWG from the app's Excel file.
;;;
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
(defun ts:val (v)
  (if (= (type v) 'VARIANT)
    (if (member (vlax-variant-type v) '(0 1 10)) nil (vlax-variant-value v))
    v))

;; rows of the "מדידה" sheet (found by its headers B1="X", C1="Y"), as lists of values
(defun ts:read (path / xl was wbs wb opened sh rows val)
  (setq was (vl-catch-all-apply 'vlax-get-object (list "Excel.Application")))
  (if (vl-catch-all-error-p was) (setq was nil))
  (setq xl (vlax-get-or-create-object "Excel.Application"))
  (if (null xl) (progn (princ "\nExcel is not installed on this computer.") (exit)))
  (setq wbs (vlax-get-property xl 'Workbooks))
  (vlax-for w wbs
    (if (= (strcase (vlax-get-property w 'FullName)) (strcase path)) (setq wb w)))
  (if (null wb)
    (setq wb (vlax-invoke-method wbs 'Open path 0 :vlax-true) opened T))
  (vl-catch-all-apply 'vlax-invoke-method (list xl 'Calculate))
  (vlax-for s (vlax-get-property wb 'Worksheets)
    (if (and (null sh)
             (= (ts:str (ts:val (vlax-get-property (vlax-get-property s 'Range "B1") 'Value2))) "X")
             (= (ts:str (ts:val (vlax-get-property (vlax-get-property s 'Range "C1") 'Value2))) "Y"))
      (setq sh s)))
  (if sh
    (progn
      (setq val (vlax-variant-value (vlax-get-property (vlax-get-property sh 'Range "A1:K2000") 'Value2)))
      (setq rows (mapcar '(lambda (r) (mapcar 'ts:val r)) (cdr (vlax-safearray->list val))))))
  (if opened (vlax-invoke-method wb 'Close :vlax-false))
  (if (and (null was) opened) (vl-catch-all-apply 'vlax-invoke-method (list xl 'Quit)))
  (foreach o (list sh wb wbs xl) (if (and o (not (vlax-object-released-p o))) (vlax-release-object o)))
  (gc)
  (if (null sh) (progn (princ "\nNo plan sheet (B1=X, C1=Y) in this Excel. Export the Excel again from the app, version 1.33 or later.") (exit)))
  rows)

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

(defun ts:top (pts / hi) (foreach p pts (if (or (null hi) (> (cadr p) (cadr hi))) (setq hi p))) (list (car hi) (+ (cadr hi) (* 1.5 *ts-txt*))))

;; text centred on p, inside the block
(defun ts:addtext (blk p s ht lay / o)
  (setq o (vla-AddText blk s (ts:pt p) ht))
  (vla-put-Alignment o 10) ; middle centre
  (vla-put-TextAlignmentPoint o (ts:pt p))
  (if (and tb:textstyle (tblsearch "STYLE" tb:textstyle)) (vla-put-StyleName o tb:textstyle))
  (ts:on o lay))

(defun ts:addsq (blk c h lay / o)
  (setq o (vla-AddLightWeightPolyline blk
            (ts:arr (list (list (- (car c) h) (- (cadr c) h)) (list (+ (car c) h) (- (cadr c) h))
                          (list (+ (car c) h) (+ (cadr c) h)) (list (- (car c) h) (+ (cadr c) h))))))
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
(defun ts:wholeins (/ ss i e r)
  (if (setq ss (ssget "_X" (list '(0 . "INSERT") (cons 2 *ts-block*))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))))
      (if (not (equal (ts:role e) "ring")) (setq r e))))
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

;; block scale for the trees: TSIZE of this drawing, else 1.5 m like TREEBLK
(defun ts:oriscale (bn / sc)
  (setq sc (car (tb:size)))
  (if (null sc)
    (progn (setq sc (/ (cond ((tb:wanted)) (1.5)) (ts:unitsize bn))) (vlax-ldata-put "ORI_TREES" "scale" sc)))
  sc)

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
(defun ts:path (ask / p)
  (setq p (vlax-ldata-get "TREESURVEY" "excel"))
  (if (or ask (null p) (not (findfile p)))
    (progn
      (setq p (getfiled "Tree survey Excel (from the app)" (if p p "") "xlsm;xlsx" 0))
      (if p (vlax-ldata-put "TREESURVEY" "excel" p))))
  p)

;; ---------- commands ----------
(defun ts:run (path / doc rows old x y lx ly code lay num c e tp cnt areas pairs tr bn sc sz blk ins ms ce rot k pts)
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
  ;; fill the block from the Excel, in Excel coordinates
  (setq blk (ts:emptyblock doc))
  (foreach r rows
    (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
    (if (and (/= num "") x y)
      (progn
        (setq c (list x y) cnt (1+ cnt)
              lx (ts:num (nth 3 r)) ly (ts:num (nth 4 r))
              code (fix (cond ((ts:num (nth 8 r))) (0)))
              bn (ts:oriblock code))
        (if bn
          ;; ori's tree block by designation, number centred on it, square for a tree added in the field
          (progn
            (tb:layer tb:blocklayer) (tb:layer tb:textlayer)
            (setq sc (ts:oriscale bn) sz (* sc (ts:unitsize bn)))
            (ts:on (vla-InsertBlock blk (ts:pt c) bn sc sc sc 0.0) tb:blocklayer)
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
  ;; areas
  (foreach r rows
    (if (and (nth 10 r) (> (length (setq pts (ts:pts (nth 10 r)))) 2))
      (progn
        (setq lay (ts:layer *ts-area-layer*) k (vla-AddLightWeightPolyline blk (ts:arr pts)))
        (vla-put-Closed k :vlax-true) (ts:on k lay)
        (if (/= (ts:str (nth 9 r)) "") (ts:addtext blk (ts:top pts) (ts:str (nth 9 r)) (* 1.5 *ts-txt*) lay))
        (setq areas (1+ areas)))))
  ;; the one insert of the block: kept where you put it; new = where the older loose marks were, else in place
  (if ins
    (vla-Update (vlax-ename->vla-object ins))
    (progn
      (setq tr (if tr tr '(1.0 0.0 0.0 0.0))
            sc (sqrt (+ (* (nth 0 tr) (nth 0 tr)) (* (nth 1 tr) (nth 1 tr))))
            rot (atan (nth 1 tr) (nth 0 tr)))
      (setq e (vlax-vla-object->ename (vla-InsertBlock ms (vlax-3d-point (nth 2 tr) (nth 3 tr) 0.0) *ts-block* sc sc sc rot)))
      (entmod (append (entget e) (ts:xd *ts-block* "all")))))
  (vla-Regen doc 1)
  (setq tb:busy nil tb:pending nil tb:dbpend nil)
  (setvar "CMDECHO" ce)
  (vla-EndUndoMark doc)
  (princ (strcat "\nTREES: " (itoa cnt) " trees" (if (> areas 0) (strcat ", " (itoa areas) " areas") "")
                 " in block \"" *ts-block* "\"" (if bn " (your tree blocks)" "") "."))
  (princ))

(defun c:TREES (/ p)
  (regapp *ts-app*)
  (if (setq p (ts:path nil)) (ts:run p))
  (princ))

(defun c:TREESFILE (/ p)
  (regapp *ts-app*)
  (if (setq p (ts:path T)) (ts:run p))
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
  (if (and (setq p (vlax-ldata-get "TREESURVEY" "excel")) (findfile p))
    (vl-catch-all-apply 'ts:run (list p)))
  (princ))

(princ "\nTree survey loaded. Commands: TREES, TREESFILE, TREESRESET")
(princ)
