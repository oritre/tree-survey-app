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
;;;   TREESRESET  delete everything this command drew, so the next TREES places the numbers again
;;;
;;; Needs BricsCAD (or AutoCAD) on Windows with Microsoft Excel installed: the Excel is read through Excel itself,
;;; so the designations are read even while the file is open in Excel (save it first to be safe).
;;; Re-running TREES updates colors and numbers. Numbers you moved by hand keep their place.
;;; Moved drawing: the marks may be copied to another drawing and moved / rotated there. TREES then works out the
;;; move from the trees already in the drawing (Excel X,Y -> where the tree is now), keeps every existing tree where
;;; it is, and places new trees and the areas with the same move. Run TREES once in the original place first.
;;; The surveyor's own tree blocks are never changed.
;;; Each tree is an insert of the block "trees" (*ts-block*). If the drawing already has a block with that name,
;;; it is used as is, so you can draw your own tree symbol; otherwise a ring is created. Put the symbol on layer 0
;;; so it takes the designation color of the tree's layer.

(vl-load-com)

(setq *ts-app* "TREESURVEY")
(setq *ts-txt* 0.5)   ; number height (m)
(setq *ts-r* 0.45)    ; ring radius (m)
(setq *ts-w* 0.12)    ; ring width (m)
(setq *ts-block* "trees") ; block inserted at every tree

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

;; ---------- drawing ----------
; the block "trees": kept if the drawing has it, else a ring on layer 0 (color BYLAYER)
(defun ts:block ()
  (if (not (tblsearch "BLOCK" *ts-block*))
    (progn
      (entmake (list '(0 . "BLOCK") (cons 2 *ts-block*) '(70 . 0) '(10 0.0 0.0 0.0)))
      (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbPolyline") '(90 . 2) '(70 . 1)
                     (cons 43 *ts-w*)
                     (list 10 (- *ts-r*) 0.0) '(42 . 1.0)
                     (list 10 *ts-r* 0.0) '(42 . 1.0)))
      (entmake '((0 . "ENDBLK")))))
  *ts-block*)

(defun ts:ring (c lay num)
  (entmake (append
    (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 lay) '(100 . "AcDbBlockReference") (cons 2 (ts:block))
          (list 10 (car c) (cadr c) 0.0) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) '(50 . 0.0))
    (ts:xd num "ring"))))

; square frame around a tree that is not the surveyor's (added in the field)
(defun ts:box (c lay num / q)
  (setq q (+ *ts-r* 0.25))
  (entmake (append
    (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1)
          (cons 43 (* 0.6 *ts-w*))
          (list 10 (- (car c) q) (- (cadr c) q)) (list 10 (+ (car c) q) (- (cadr c) q))
          (list 10 (+ (car c) q) (+ (cadr c) q)) (list 10 (- (car c) q) (+ (cadr c) q)))
    (ts:xd num "box"))))

(defun ts:text (p s num)
  (entmake (append
    (list '(0 . "TEXT") '(100 . "AcDbEntity") (cons 8 (ts:layer *ts-num-layer*)) '(100 . "AcDbText")
          (list 10 (car p) (cadr p) 0.0) (cons 40 *ts-txt*) (cons 1 s) '(72 . 1)
          (list 11 (car p) (cadr p) 0.0) '(100 . "AcDbText") '(73 . 2))
    (ts:xd num "num"))))

(defun ts:lead (c p num / d a s e)
  (setq d (distance c p))
  (if (> d (+ *ts-r* (* 1.4 *ts-txt*)))
    (progn
      (setq a (angle c p)
            s (polar c a *ts-r*)
            e (polar c a (- d (* 0.6 *ts-txt*))))
      (entmake (append
        (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 (ts:layer *ts-num-layer*)) '(100 . "AcDbLine")
              (list 10 (car s) (cadr s) 0.0) (list 11 (car e) (cadr e) 0.0))
        (ts:xd num "lead"))))))

(defun ts:text-pt (e / d)
  (setq d (entget e))
  (if (and (= (cdr (assoc 72 d)) 0) (= (cdr (assoc 73 d)) 0)) (cdr (assoc 10 d)) (cdr (assoc 11 d))))

(defun ts:area (name pts / l)
  (setq l (ts:layer *ts-area-layer*))
  (entmake (append
    (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 l) '(100 . "AcDbPolyline") (cons 90 (length pts)) '(70 . 1))
    (mapcar '(lambda (p) (list 10 (car p) (cadr p))) pts)
    (ts:xd name "area")))
  (if (/= name "")
    (ts:text-area (ts:top pts) name)))

(defun ts:top (pts / hi) (foreach p pts (if (or (null hi) (> (cadr p) (cadr hi))) (setq hi p))) (list (car hi) (+ (cadr hi) (* 1.5 *ts-txt*))))

(defun ts:text-area (p s)
  (entmake (append
    (list '(0 . "TEXT") '(100 . "AcDbEntity") (cons 8 (car *ts-area-layer*)) '(100 . "AcDbText")
          (list 10 (car p) (cadr p) 0.0) (cons 40 (* 1.5 *ts-txt*)) (cons 1 s) '(72 . 1)
          (list 11 (car p) (cadr p) 0.0) '(100 . "AcDbText") '(73 . 1))
    (ts:xd s "areaname"))))

;; ---------- moved drawing ----------
;; where an existing tree mark is now (block insert, or the ring of older versions)
(defun ts:center (e / d pts)
  (setq d (entget e))
  (if (= (cdr (assoc 0 d)) "INSERT")
    (list (car (cdr (assoc 10 d))) (cadr (cdr (assoc 10 d))))
    (progn
      (setq pts (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 10)) d)))
      (list (/ (apply '+ (mapcar 'car pts)) (length pts)) (/ (apply '+ (mapcar 'cadr pts)) (length pts))))))

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

(defun ts:tp (tr p)
  (if tr
    (list (+ (* (nth 0 tr) (car p)) (- (* (nth 1 tr) (cadr p))) (nth 2 tr))
          (+ (* (nth 1 tr) (car p)) (* (nth 0 tr) (cadr p)) (nth 3 tr)))
    p))

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
(defun ts:run (path / doc rows old seen x y lx ly code lay num c e tp cnt areas pairs tr)
  (princ (strcat "\nReading " path " ..."))
  (setq rows (ts:read path))
  (setq old (ts:existing) cnt 0)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (vla-StartUndoMark doc)
  ;; the drawing may have been moved: compare the trees already drawn with their X,Y in the Excel
  (foreach r rows
    (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
    (if (and (/= num "") x y (setq e (ts:find old num "ring")) (entget e))
      (setq pairs (cons (list (list x y) (ts:center e)) pairs))))
  (setq tr (ts:fit pairs))
  (if (and tr (or (> (abs (nth 2 tr)) 0.01) (> (abs (nth 3 tr)) 0.01) (> (abs (nth 1 tr)) 1e-6)))
    (princ "\nThe marks were moved in this drawing: new trees and areas are placed with the same move."))
  ;; trees
  (foreach r rows
    (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
    (if (and (/= num "") x y)
      (progn
        (setq c (ts:tp tr (list x y))
              lx (ts:num (nth 3 r)) ly (ts:num (nth 4 r))
              code (fix (cond ((ts:num (nth 8 r))) (0)))
              lay (ts:layer (cdr (cond ((assoc code *ts-layers*)) ((assoc 0 *ts-layers*))))))
        (setq seen (cons num seen) cnt (1+ cnt))
        ;; tree mark (block "trees"), color by designation. An existing one stays where it is
        (if (setq e (ts:find old num "ring")) (progn (setq c (ts:center e)) (entdel e)))
        (ts:ring c lay num)
        ;; square frame: a tree added in the field (no surveyor tree, column H empty)
        (if (setq e (ts:find old num "box")) (entdel e))
        (if (= (ts:str (nth 7 r)) "") (ts:box c lay num))
        ;; number: keep it where it is (it may have been moved by hand), else at the place from the app
        (if (setq e (ts:find old num "num"))
          (progn (setq tp (ts:text-pt e)) (entmod (subst (cons 1 num) (assoc 1 (entget e)) (entget e))))
          (progn (setq tp (if (and lx ly) (ts:tp tr (list lx ly)) (list (+ (car c) *ts-r* *ts-txt*) (cadr c)))) (ts:text tp num)))
        ;; leader from the ring to the number, when the number is not right next to it
        (if (setq e (ts:find old num "lead")) (entdel e))
        (ts:lead c tp num))))
  ;; trees that are no longer in the Excel
  (foreach o old
    (if (and (member (cadr o) '("ring" "box" "num" "lead")) (not (member (car o) seen)) (entget (caddr o)))
      (entdel (caddr o))))
  ;; areas: drawn again every time
  (foreach o old (if (and (member (cadr o) '("area" "areaname")) (entget (caddr o))) (entdel (caddr o))))
  (setq areas 0)
  (foreach r rows
    (if (and (nth 10 r) (> (length (ts:pts (nth 10 r))) 2))
      (progn (ts:area (ts:str (nth 9 r)) (mapcar '(lambda (p) (ts:tp tr p)) (ts:pts (nth 10 r)))) (setq areas (1+ areas)))))
  (vla-EndUndoMark doc)
  (princ (strcat "\nTREES: " (itoa cnt) " trees" (if (> areas 0) (strcat ", " (itoa areas) " areas") "") " updated."))
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
