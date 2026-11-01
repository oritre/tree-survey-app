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
;;; The surveyor's own tree blocks are never changed.

(vl-load-com)

(setq *ts-app* "TREESURVEY")
(setq *ts-txt* 0.5)   ; number height (m)
(setq *ts-r* 0.45)    ; ring radius (m)
(setq *ts-w* 0.12)    ; ring width (m)

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
(defun ts:ring (c lay num)
  (entmake (append
    (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(100 . "AcDbPolyline") '(90 . 2) '(70 . 1)
          (cons 43 *ts-w*)
          (list 10 (- (car c) *ts-r*) (cadr c)) '(42 . 1.0)
          (list 10 (+ (car c) *ts-r*) (cadr c)) '(42 . 1.0))
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
(defun ts:run (path / doc rows old seen x y lx ly code lay num c e tp cnt areas)
  (princ (strcat "\nReading " path " ..."))
  (setq rows (ts:read path))
  (setq old (ts:existing) cnt 0)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (vla-StartUndoMark doc)
  ;; trees
  (foreach r rows
    (setq num (ts:str (nth 0 r)) x (ts:num (nth 1 r)) y (ts:num (nth 2 r)))
    (if (and (/= num "") x y)
      (progn
        (setq c (list x y)
              lx (ts:num (nth 3 r)) ly (ts:num (nth 4 r))
              code (fix (cond ((ts:num (nth 8 r))) (0)))
              lay (ts:layer (cdr (cond ((assoc code *ts-layers*)) ((assoc 0 *ts-layers*))))))
        (setq seen (cons num seen) cnt (1+ cnt))
        ;; ring: always at the tree, color by designation
        (if (setq e (ts:find old num "ring")) (entdel e))
        (ts:ring c lay num)
        ;; square frame: a tree added in the field (no surveyor tree, column H empty)
        (if (setq e (ts:find old num "box")) (entdel e))
        (if (= (ts:str (nth 7 r)) "") (ts:box c lay num))
        ;; number: keep it where it is (it may have been moved by hand), else at the place from the app
        (if (setq e (ts:find old num "num"))
          (progn (setq tp (ts:text-pt e)) (entmod (subst (cons 1 num) (assoc 1 (entget e)) (entget e))))
          (progn (setq tp (if (and lx ly) (list lx ly) (list (+ x *ts-r* *ts-txt*) y))) (ts:text tp num)))
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
      (progn (ts:area (ts:str (nth 9 r)) (ts:pts (nth 10 r))) (setq areas (1+ areas)))))
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
